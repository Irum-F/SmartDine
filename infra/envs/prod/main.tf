
# Existing hosted zone, not created or destroyed here
data "aws_route53_zone" "main" {
  name = var.hosted_zone
}

data "aws_caller_identity" "current" {}

# Static NAT IP from bootstrap (it's on MongoDB Atlas's allowlist)
data "aws_eip" "nat" {
  tags = { Name = "${var.project}-nat-eip" }
}

data "aws_ecr_repository" "api" {
  name = "${var.project}-api"
}

data "aws_ssm_parameter" "api_image_tag" {
  name = "/${var.project}/api/image-tag"
}

data "aws_ecr_repository" "frontend" {
  name = "${var.project}-frontend"
}

data "aws_ssm_parameter" "frontend_image_tag" {
  name = "/${var.project}/frontend/image-tag"
}

data "aws_secretsmanager_secret" "mongodb_uri" {
  name = "${var.project}/mongodb-uri"
}

data "aws_secretsmanager_secret" "jwt" {
  name = "${var.project}/jwt-secret"
}

# AWS keeps this list of CloudFront's IP addresses up to date
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Photo bucket, created by bootstrap so photos survive the destroy pipeline
data "aws_s3_bucket" "media" {
  bucket = "smartdine-media-${data.aws_caller_identity.current.account_id}"
}

# Secret header CloudFront adds to every request; the load balancer refuses requests without it
resource "random_password" "origin_secret" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------

module "vpc" {
  source                = "../../modules/vpc"
  name                  = var.project
  cidr                  = "10.20.0.0/16"
  az_count              = 2
  nat_eip_allocation_id = data.aws_eip.nat.id
}

# ---------------------------------------------------------------------------
# Certificates (two, because each AWS certificate only works in its own region)
# ---------------------------------------------------------------------------

# For the load balancer (ap-south-1): the main domain plus the name CloudFront uses to reach it
module "acm" {
  source                    = "../../modules/acm"
  domain                    = var.domain                         # CHECK 1
  zone_id                   = data.aws_route53_zone.main.zone_id # CHECK 1
  subject_alternative_names = ["origin.${var.domain}"]
}

# For CloudFront (must be us-east-1): the main domain only
module "acm_cloudfront" {
  source    = "../../modules/acm"
  providers = { aws = aws.us_east_1 }

  domain  = var.domain                         # CHECK 1
  zone_id = data.aws_route53_zone.main.zone_id # CHECK 1
}

# ---------------------------------------------------------------------------
# Load balancer (only reachable from CloudFront)
# ---------------------------------------------------------------------------

module "alb" {
  source                  = "../../modules/alb"
  name                    = var.project
  vpc_id                  = module.vpc.vpc_id
  vpc_cidr                = module.vpc.vpc_cidr
  public_subnet_ids       = module.vpc.public_subnet_ids
  certificate_arn         = module.acm.certificate_arn
  ingress_prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
}

# ---------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------

# smartdine.lab.irum.dev → CloudFront (IPv4)
resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false # must be false for CloudFront
  }
}

# smartdine.lab.irum.dev → CloudFront (IPv6)
resource "aws_route53_record" "app_ipv6" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

# origin.smartdine.lab.irum.dev → the load balancer. Only CloudFront uses this name; it's on the load balancer's certificate.
resource "aws_route53_record" "origin" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "origin.${var.domain}"
  type    = "A"
  alias {
    name                   = module.alb.dns_name # CHECK 2
    zone_id                = module.alb.zone_id  # CHECK 2
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"
  name   = var.project
}

module "frontend" {
  source                = "../../modules/ecs-service"
  name                  = "${var.project}-frontend"
  region                = var.region
  cluster_id            = module.ecs_cluster.cluster_id
  execution_role_arn    = module.ecs_cluster.execution_role_arn
  execution_role_name   = module.ecs_cluster.execution_role_name
  image                 = "${data.aws_ecr_repository.frontend.repository_url}:${nonsensitive(data.aws_ssm_parameter.frontend_image_tag.value)}"
  container_port        = 3000
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  listener_arn          = module.alb.https_listener_arn
  listener_priority     = 100
  path_patterns         = ["/*"]
  health_check_path     = "/healthz"
  desired_count         = 2
  origin_secret         = random_password.origin_secret.result

  environment = {
    NODE_ENV = "production"
    PORT     = "3000"
    HOSTNAME = "0.0.0.0" # ECS sets its own HOSTNAME; Next.js must listen on every interface
  }
}

module "api" {
  source                = "../../modules/ecs-service"
  name                  = "${var.project}-api"
  region                = var.region
  cluster_id            = module.ecs_cluster.cluster_id
  execution_role_arn    = module.ecs_cluster.execution_role_arn
  execution_role_name   = module.ecs_cluster.execution_role_name
  image                 = "${data.aws_ecr_repository.api.repository_url}:${nonsensitive(data.aws_ssm_parameter.api_image_tag.value)}"
  container_port        = 4000
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  listener_arn          = module.alb.https_listener_arn
  listener_priority     = 10
  path_patterns         = ["/api/*", "/socket.io/*"]
  health_check_path     = "/api/health"
  desired_count         = 2
  sticky_sessions       = true
  origin_secret         = random_password.origin_secret.result
  task_role_policy_json = data.aws_iam_policy_document.api_media.json
  cpu                   = 512
  memory                = 1024 # room for resizing photos

  environment = {
    NODE_ENV         = "production"
    PORT             = "4000"
    APP_ORIGIN       = "https://${var.domain}"
    MEDIA_BUCKET     = data.aws_s3_bucket.media.bucket
    AWS_REGION       = var.region
    TRUST_PROXY_HOPS = "2" # CloudFront + load balancer
  }

  secrets = {
    MONGODB_URI = data.aws_secretsmanager_secret.mongodb_uri.arn
    JWT_SECRET  = data.aws_secretsmanager_secret.jwt.arn
    REDIS_URL   = module.redis.url_secret_arn
  }
}

# What the API itself may do with the photo bucket
data "aws_iam_policy_document" "api_media" {
  # Photo uploads arrive here first (the browser's signed upload uses these permissions)
  statement {
    sid       = "UploadInbox"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${data.aws_s3_bucket.media.arn}/uploads/*"]
  }

  # Finished photos, which CloudFront serves
  statement {
    sid       = "PublishedPhotos"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${data.aws_s3_bucket.media.arn}/media/*"]
  }
}

# ---------------------------------------------------------------------------
# Real-time: Valkey for Socket.IO
# ---------------------------------------------------------------------------

module "redis" {
  source                     = "../../modules/redis"
  name                       = "${var.project}-cache"
  secret_name                = "${var.project}/redis-url"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [module.api.security_group_id]
}