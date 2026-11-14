variable "name" { type = string }
variable "region" { type = string }
variable "cluster_id" { type = string }
variable "execution_role_arn" { type = string }
variable "image" { type = string }
variable "container_port" { type = number }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "alb_security_group_id" { type = string }
variable "listener_arn" { type = string }
variable "listener_priority" { type = number }
variable "path_patterns" { type = list(string) }

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "health_check_path" {
  type    = string
  default = "/"
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "environment" {
  type        = map(string)
  default     = {}
  description = "Non-secret environment variables"
}

variable "execution_role_name" { type = string }

variable "secrets" {
  type        = map(string)
  default     = {}
  description = "Environment variable name => Secrets Manager secret ARN"
}

variable "sticky_sessions" {
  type    = bool
  default = false
}