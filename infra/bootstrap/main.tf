# SmartDine production environment

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

variable "github_owner_id" {
  description = "Numeric GitHub account ID"
  default     = "297141229"
}

variable "github_repo_id" {
  description = "Numeric GitHub repository ID"
  default     = "1440567584"
}

locals {
  gh_owner = split("/", var.github_repo)[0]
  gh_repo  = split("/", var.github_repo)[1]
}

variable "region" { default = "ap-south-1" }
variable "project" { default = "smartdine" }
variable "github_repo" { 
  description = "GitHub repo in owner/name form"
  default     = "Irum-F/SmartDine"
}

data "aws_caller_identity" "me" {}

# Remote state bucket
resource "aws_s3_bucket" "state" {
  bucket = "${var.project}-tfstate-${data.aws_caller_identity.me.account_id}"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ECR repositories (kept across destroys so images survive)
resource "aws_ecr_repository" "app" {
  for_each             = toset(["frontend", "api", "notifier"])
  name                 = "${var.project}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

# GitHub Actions login to AWS via OIDC (no stored AWS keys)
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "${var.project}-github-actions"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "repo:${local.gh_owner}@${var.github_owner_id}/${local.gh_repo}@${var.github_repo_id}:*",
            "repo:${var.github_repo}:*",
          ]
        }
      }
    }]
  })
}

# Broad access so Terraform can create everything
resource "aws_iam_role_policy_attachment" "github_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "state_bucket" { value = aws_s3_bucket.state.bucket }
output "github_role_arn" { value = aws_iam_role.github_actions.arn }
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.app : k => r.repository_url } }

# Static NAT IP, kept across destroys so MongoDB Atlas can allow it
resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.project}-nat-eip" }
}

# The secret's container only; its value is set by hand, never in Terraform
resource "aws_secretsmanager_secret" "mongodb_uri" {
  name        = "${var.project}/mongodb-uri"
  description = "MongoDB Atlas connection string for the SmartDine API"
}

# The image version each service should run. The App Build pipeline updates it.
resource "aws_ssm_parameter" "image_tag" {
  for_each = toset(["frontend", "api", "notifier"])
  name     = "/${var.project}/${each.key}/image-tag"
  type     = "String"
  value    = "none"

  lifecycle {
    ignore_changes = [value] # the pipeline owns the value after creation
  }
}

output "nat_public_ip"      { value = aws_eip.nat.public_ip }
output "mongodb_secret_arn" { value = aws_secretsmanager_secret.mongodb_uri.arn }