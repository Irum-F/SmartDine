variable "domain" { type = string }
variable "zone_id" { type = string }
variable "subject_alternative_names" {
  description = "Extra names on the certificate"
  type        = list(string)
  default     = []
}