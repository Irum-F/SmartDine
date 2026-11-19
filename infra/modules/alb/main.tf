terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP and HTTPS to the load balancer"
  vpc_id      = var.vpc_id

  # Open to the internet only when nothing sits in front (the old setup)
  dynamic "ingress" {
    for_each = length(var.ingress_prefix_list_ids) == 0 ? [80, 443] : []
    content {
      description = "Public ${ingress.value}"
      from_port   = ingress.value
      to_port     = ingress.value
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  # Behind CloudFront: only CloudFront's edge servers, HTTPS only (CloudFront handles the HTTP→HTTPS redirect)
  dynamic "ingress" {
    for_each = length(var.ingress_prefix_list_ids) > 0 ? [443] : []
    content {
      description     = "HTTPS from CloudFront only"
      from_port       = 443
      to_port         = 443
      protocol        = "tcp"
      prefix_list_ids = var.ingress_prefix_list_ids
    }
  }

  egress {
    description = "Only to targets inside the VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1" # all protocols
    cidr_blocks = [var.vpc_cidr]
  }
}

resource "aws_lb" "this" {
  name                       = "${var.name}-alb"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  idle_timeout               = 120 # keeps idle WebSocket connections open longer
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  # Placeholder until the ECS services exist - they'll add their own routing rules
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}