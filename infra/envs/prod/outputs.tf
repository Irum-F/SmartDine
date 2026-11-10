output "vpc_id" { value = module.vpc.vpc_id }
output "public_subnet_ids" { value = module.vpc.public_subnet_ids }
output "private_subnet_ids" { value = module.vpc.private_subnet_ids }
output "zone_id" { value = data.aws_route53_zone.main.zone_id }

output "app_url" { value = "https://${var.domain}" }
output "api_security_group_id" { value = module.api.security_group_id }