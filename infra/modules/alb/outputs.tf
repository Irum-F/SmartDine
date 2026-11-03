output "alb_arn" { value = aws_lb.this.arn }
output "dns_name" { value = aws_lb.this.dns_name }
output "zone_id" { value = aws_lb.this.zone_id }
output "https_listener_arn" { value = aws_lb_listener.https.arn }
output "security_group_id" { value = aws_security_group.alb.id }