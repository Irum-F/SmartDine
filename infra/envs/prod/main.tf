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
  source  = "../../modules/acm"
  domain  = var.domain
  zone_id = data.aws_route53_zone.main.zone_id
}

module "alb" {
  source            = "../../modules/alb"
  name              = var.project
  vpc_id            = module.vpc.vpc_id
  vpc_cidr          = module.vpc.vpc_cidr
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = module.acm.certificate_arn
}

# smartdine.lab.irum.dev → the load balancer
resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = module.alb.dns_name
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
  image                 = "public.ecr.aws/nginx/nginx:latest" # temporary placeholder until real app image
  container_port        = 80
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  alb_security_group_id = module.alb.security_group_id
  listener_arn          = module.alb.https_listener_arn
  listener_priority     = 100
  path_patterns         = ["/*"]
  execution_role_name   = module.ecs_cluster.execution_role_name
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

  environment = {
    NODE_ENV = "production"
    PORT     = "4000"
  }

  secrets = {
    MONGODB_URI = data.aws_secretsmanager_secret.mongodb_uri.arn
    JWT_SECRET  = data.aws_secretsmanager_secret.jwt.arn
  }
}