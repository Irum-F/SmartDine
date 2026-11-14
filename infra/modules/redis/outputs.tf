# Taken from the secret *version*, so the API service waits until the value exists
output "url_secret_arn" { value = aws_secretsmanager_secret_version.url.arn }
output "security_group_id" { value = aws_security_group.this.id }