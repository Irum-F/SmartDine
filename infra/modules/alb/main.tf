resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTP and HTTPS to the load balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP, redirected to HTTPS"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
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
      message_body = "SmartDine is coming soon"
      status_code  = "200"
    }
  }
}