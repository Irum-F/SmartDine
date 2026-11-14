terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80" # first versions that support the valkey engine
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }
}