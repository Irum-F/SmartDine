variable "name" { type = string }
variable "secret_name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_security_group_ids" { type = list(string) }
variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}
variable "num_cache_clusters" {
  type    = number
  default = 2
}