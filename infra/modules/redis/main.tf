resource "random_password" "auth" {
  length  = 40
  special = false # ElastiCache rejects some special characters in auth tokens
}

resource "aws_security_group" "this" {
  name        = "${var.name}-sg"
  description = "Valkey: reachable only from the API tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Valkey from API"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }
  # No egress rules: the cache never starts connections
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "Socket.IO fan-out between API containers"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = var.node_type
  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.this.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth.result
  snapshot_retention_limit   = 0 # pub/sub only, nothing worth backing up
  apply_immediately          = true
}

resource "aws_secretsmanager_secret" "url" {
  name                    = var.secret_name
  recovery_window_in_days = 0 # so destroy → apply can recreate the same name straight away
}

resource "aws_secretsmanager_secret_version" "url" {
  secret_id     = aws_secretsmanager_secret.url.id
  secret_string = "rediss://:${random_password.auth.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
}