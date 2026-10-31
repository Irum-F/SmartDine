variable "name" {
  type        = string
  description = "Name prefix for all VPC resources"
}

variable "cidr" {
  type        = string
  description = "VPC CIDR block"
}

variable "az_count" {
  type        = number
  default     = 2
  description = "Number of Availability Zones to spread subnets across"
}