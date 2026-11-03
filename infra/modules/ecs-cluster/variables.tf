variable "name" { type = string }

variable "container_insights" {
  type        = bool
  default     = false # adds CloudWatch cost
  description = "Enable CloudWatch Container Insights"
}