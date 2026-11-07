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

variable "nat_eip_allocation_id" {
  type        = string
  description = "Allocation ID of a pre-created Elastic IP for the NAT gateway"
}