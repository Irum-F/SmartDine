# Existing hosted zone, not created or destroyed here
data "aws_route53_zone" "main" {
  name = var.hosted_zone
}

module "vpc" {
  nat_eip_allocation_id = data.aws_eip.nat.id
  source                = "../../modules/vpc"
  name                  = var.project
  cidr                  = "10.20.0.0/16"
  az_count              = 2
}

module "acm" {
  source                    = "../../modules/acm"
  domain                    = var.domain
  zone_id                   = data.aws_route53_zone.main.zone_id
  subject_alternative_names = ["origin.${var.domain}"]
}

module "alb" {
  source                  = "../../modules/alb"
  name                    = var.project
  vpc_id                  = module.vpc.vpc_id
  vpc_cidr                = module.vpc.vpc_cidr
  public_subnet_ids       = module.vpc.public_subnet_ids
  certificate_arn         = module.acm.certificate_arn
  ingress_prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
}

# smartdine.lab.irum.dev → the load balancer
resource "aws_route53_record" "app" { # ← keep your existing resource name
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false # must be false for CloudFront
  }
}

resource "aws_route53_record" "app_ipv6" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

# The name CloudFront uses to reach the load balancer; it's on the load balancer's certificate
resource "aws_route53_record" "origin" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = "origin.${var.domain}"
  type    = "A"
  alias {
    name                   = module.alb.dns_name # ← use the same two values your old app record used
    zone_id                = module.alb.zone_id
    evaluate_target_health = true
  }
}

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
  image                 = "${data.aws_ecr_repository.frontend.repository_url}:${nonsensitive(data.aws_ssm_parameter.frontend_image_tag.value)}"
  container_port        = 3000
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  listener_arn          = module.alb.https_listener_arn
  listener_priority     = 100
  path_patterns         = ["/*"]
  execution_role_name   = module.ecs_cluster.execution_role_name
  health_check_path     = "/healthz"
  environment           = { NODE_ENV = "production", PORT = "3000", HOSTNAME = "0.0.0.0" }
  desired_count         = 2
  origin_secret         = random_password.origin_secret.result
}

module "acm_cloudfront" {
  source    = "../../modules/acm"
  providers = { aws = aws.us_east_1 }

  domain_name = var.domain                         # ← same as in module "acm"
  zone_id     = data.aws_route53_zone.this.zone_id # ← same as in module "acm"
}

data "aws_eip" "nat" {
  tags = { Name = "${var.project}-nat-eip" }
}

data "aws_ecr_repository" "api" {
  name = "${var.project}-api"
}

data "aws_ssm_parameter" "api_image_tag" {
  name = "/${var.project}/api/image-tag"
}

data "aws_secretsmanager_secret" "mongodb_uri" {
  name = "${var.project}/mongodb-uri"
}

data "aws_secretsmanager_secret" "jwt" {
  name = "${var.project}/jwt-secret"
}

data "aws_ecr_repository" "frontend" {
  name = "${var.project}-frontend"
}

data "aws_ssm_parameter" "frontend_image_tag" {
  name = "/${var.project}/frontend/image-tag"
}

data "aws_caller_identity" "current" {}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing" # AWS keeps this list of CloudFront IPs up to date
}

data "aws_s3_bucket" "media" {
  bucket = "smartdine-media-${data.aws_caller_identity.current.account_id}" # created by bootstrap in Part A
}

resource "random_password" "origin_secret" {
  length  = 48
  special = false
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
  memory                = 1024

  environment = {
    NODE_ENV         = "production"
    PORT             = "4000"
    APP_ORIGIN       = "https://${var.domain}"
    MEDIA_BUCKET     = data.aws_s3_bucket.media.bucket
    AWS_REGION       = var.region
    TRUST_PROXY_HOPS = "2"
  }

  secrets = {
    MONGODB_URI = data.aws_secretsmanager_secret.mongodb_uri.arn
    JWT_SECRET  = data.aws_secretsmanager_secret.jwt.arn
    REDIS_URL   = module.redis.url_secret_arn
  }
}

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

module "redis" {
  source                     = "../../modules/redis"
  name                       = "${var.project}-cache"
  secret_name                = "${var.project}/redis-url"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [module.api.security_group_id]
}