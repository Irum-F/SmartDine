#!/usr/bin/env bash
# Read-only: lists restaurants and staff login state. Prints no PINs.
set -euo pipefail
export AWS_REGION=ap-south-1

CLUSTER=$(aws ecs list-clusters --query "clusterArns[?contains(@,'smartdine')]|[0]" --output text)
SERVICE=$(aws ecs list-services --cluster "$CLUSTER" --query "serviceArns[?contains(@,'api')]|[0]" --output text)
TASKDEF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
NETCONF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].networkConfiguration' --output json)
CONTAINER=$(aws ecs describe-task-definition --task-definition "$TASKDEF" --query 'taskDefinition.containerDefinitions[0].name' --output text)
LOGGROUP=$(aws ecs describe-task-definition --task-definition "$TASKDEF" --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)

SCRIPT="const m=(await import('mongoose')).default; await m.connect(process.env.MONGODB_URI); const {Restaurant}=await import('./src/models/restaurant.js'); const {Staff}=await import('./src/models/staff.js'); const rs=await Restaurant.find({},{slug:1}).lean(); console.log('DIAG restaurants', JSON.stringify(rs.map(r=>r.slug))); for (const r of rs) { const st=await Staff.find({restaurantId:r._id}).lean(); console.log('DIAG staff', r.slug, JSON.stringify(st.map(s=>({username:s.username, role:s.role, active:s.active, failedAttempts:s.failedAttempts, lockedUntil:s.lockedUntil, mustChangePin:s.mustChangePin, hashStart:String(s.pinHash).slice(0,10), hashLength:String(s.pinHash).length})))); } await m.disconnect();"

jq -n --arg c "$CONTAINER" --arg s "$SCRIPT" \
  '{containerOverrides:[{name:$c, command:["node","--input-type=module","-e",$s]}]}' > /tmp/diag-overrides.json

TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$TASKDEF" --launch-type FARGATE \
  --network-configuration "$NETCONF" --overrides file:///tmp/diag-overrides.json \
  --query 'tasks[0].taskArn' --output text)
echo "Checking (about a minute)..."
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
aws logs tail "$LOGGROUP" --since 10m --format short | grep -E "DIAG|Error"