# SmartDine

A real-time restaurant ordering platform on AWS. Guests scan a QR code at their table to order, the kitchen sees orders live, and staff manage tables from their own screens.

The project focuses as much on the platform as on the app: infrastructure as code, automated pipelines, security scanning and zero-downtime deployments.

> 🚧 **In progress.** The infrastructure, pipelines and staff login are live; guest ordering and real-time updates are being built now.

## Status

**Working today**
- Custom VPC across 2 Availability Zones, an ALB with HTTPS (ACM certificate created by Terraform) and ECS Fargate services
- Reusable Terraform modules, with remote state in S3 and native state locking
- 4 GitHub Actions pipelines: app build, Terraform plan, apply and destroy
- Keyless AWS access from pipelines via OIDC, with approval gates on apply and destroy
- Trivy image scanning, Checkov and TFLint checks, and automated tests that block failing builds
- Zero-downtime deploys to ECS, with automatic rollback if a new version fails health checks
- Secrets injected from AWS Secrets Manager; nothing sensitive in the repo
- Role-based staff login with account lockout and PIN change enforcement

**Coming next**
- Guest QR ordering with table sessions and duplicate-order protection
- Live kitchen display, kept in sync across scaled containers with Redis
- WhatsApp order notifications through an SQS queue
- Autoscaling, CloudWatch alarms and a load test with a deliberate container failure

## Tech stack

## Tech stack

| Area           | Tools                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------ |
| App            | Node.js, Express, Socket.IO, MongoDB Atlas, Next.js                                              |
| Infrastructure | AWS (VPC, ALB, ACM, ECS Fargate, ECR, Route 53, Secrets Manager, CloudWatch), Terraform          |
| CI/CD          | GitHub Actions with OIDC                                                                         |
| Security       | Trivy, Checkov, TFLint                                                                           |

## Repository structure

    app/           application services (api, frontend, notifier)
    infra/         Terraform: bootstrap stack, reusable modules, prod environment
    .github/       CI/CD pipelines
    docs/          diagrams and screenshots


## A full README with the architecture diagram, demo and setup guide will replace this once the core app is complete.