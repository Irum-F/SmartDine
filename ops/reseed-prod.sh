#!/usr/bin/env bash
# Wipes and recreates the demo restaurant in production. Prints new PINs and QR tokens.
set -euo pipefail
export AWS_REGION=ap-south-1

CLUSTER=$(aws ecs list-clusters --query "clusterArns[?contains(@,'smartdine')]|[0]" --output text)
SERVICE=$(aws ecs list-services --cluster "$CLUSTER" --query "serviceArns[?contains(@,'api')]|[0]" --output text)
TASKDEF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
NETCONF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].networkConfiguration' --output json)
CONTAINER=$(aws ecs describe-task-definition --task-definition "$TASKDEF" --query 'taskDefinition.containerDefinitions[0].name' --output text)
LOGGROUP=$(aws ecs describe-task-definition --task-definition "$TASKDEF" --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)

read -rp "This WIPES the demo restaurant in production. Type 'reseed' to continue: " ok
[ "$ok" = "reseed" ] || { echo "Cancelled."; exit 1; }

TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASKDEF" --launch-type FARGATE \
  --network-configuration "$NETCONF" \
  --overrides "{\"containerOverrides\":[{\"name\":\"$CONTAINER\",\"command\":[\"node\",\"scripts/seed.js\"],\"environment\":[{\"name\":\"SEED_ALLOW_PRODUCTION\",\"value\":\"yes\"}]}]}" \
  --query 'tasks[0].taskArn' --output text)

echo "Seeding (about a minute)..."
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"

EXIT=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
TASK_ID=${TASK##*/}
aws logs tail "$LOGGROUP" --log-stream-name-prefix "ecs/$CONTAINER/$TASK_ID" --since 15m --format short
[ "$EXIT" = "0" ] && echo "✅ Seed finished." || { echo "❌ Seed failed (exit $EXIT)."; exit 1; }