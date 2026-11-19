variable "name" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "certificate_arn" { type = string }
variable "ingress_prefix_list_ids" {
  description = "If set, only these prefix lists (e.g. CloudFront) may reach the load balancer, on 443 only"
  type        = list(string)
  default     = []
}