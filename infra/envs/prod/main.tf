# Existing hosted zone, not created or destroyed here
data "aws_route53_zone" "main" {
  name = var.hosted_zone
}

module "vpc" {
  source   = "../../modules/vpc"
  name     = var.project
  cidr     = "10.20.0.0/16"
  az_count = 2
}