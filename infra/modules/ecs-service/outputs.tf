output "service_name" { value = aws_ecs_service.this.name }
output "task_role_arn" { value = aws_iam_role.task.arn }
output "task_role_name" { value = aws_iam_role.task.name }
output "security_group_id" { value = aws_security_group.service.id }
output "target_group_arn" { value = aws_lb_target_group.this.arn }