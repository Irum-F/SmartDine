terraform {
  backend "s3" {
    key          = "prod/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true # S3 state locking
  }
}