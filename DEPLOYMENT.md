# Hivemind-Prism Deployment Guide

## Complete Deployment Instructions

This guide provides step-by-step instructions for deploying Hivemind-Prism to AWS.

## Prerequisites

- AWS Account with administrator access
- AWS CLI configured with credentials
- Node.js 18+ and npm
- Python 3.12+
- Docker Desktop installed and running
- Git

## Deployment Steps

### 1. Environment Setup

```bash
# Clone repository (if applicable)
cd hivemind-prism

# Install Node.js dependencies
npm install

# Install AWS CDK globally (if not already installed)
npm install -g aws-cdk

# Verify installations
node --version  # Should be 18+
python --version  # Should be 3.12+
docker --version
cdk --version
```

### 2. Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure

# Or set environment variables
export AWS_ACCESS_KEY_ID=your_access_key_id
export AWS_SECRET_ACCESS_KEY=your_secret_access_key
export AWS_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=us-east-1
```

### 3. Bootstrap CDK (First Time Only)

```bash
# Bootstrap CDK in your AWS account/region
cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION

# This creates:
# - CDKToolkit CloudFormation stack
# - S3 bucket for CDK assets
# - ECR repositories for Docker images
# - IAM roles for deployments
```

### 4. Validate Pre-Deployment

```bash
# Run validation script to check all prerequisites
./scripts/validate-pre-deployment.sh

# This checks:
# - Required tools (node, npm, aws, cdk, docker, python3)
# - AWS authentication
# - Docker running
# - ECR repositories and images
# - Lambda function files
# - Agent Dockerfiles
```

### 5. Create ECR Repositories

```bash
# Create all ECR repositories at once
./scripts/create-ecr-repos.sh

# This creates 9 repositories:
# - 6 agent repositories (archaeologist, strategist, etc.)
# - 3 MCP server repositories (semgrep, gitleaks, trivy)
```

### 6. Build and Push Docker Images

```bash
# Build and push all Docker images to ECR
./scripts/build-and-push-images.sh

# This will:
# - Login to ECR
# - Build all 6 agent Docker images
# - Build all 3 MCP server Docker images
# - Push all images to ECR with 'latest' tag
# - Takes ~10-15 minutes depending on your machine
```

### 7. Deploy Infrastructure

```bash
# Synthesize CloudFormation templates (optional - for review)
npm run synth

# Deploy all stacks (recommended - deploys in correct order)
npm run deploy

# This will deploy 6 stacks in order:
# 1. HivemindPrism-Network (~5 min)
# 2. HivemindPrism-Security (~3 min)
# 3. HivemindPrism-Storage (~5 min)
# 4. HivemindPrism-Intelligence (~15 min - Kendra is slow)
# 5. HivemindPrism-Compute (~5 min)
# 6. HivemindPrism-Orchestration (~3 min)
# Total: ~35-40 minutes

# Or deploy stacks one by one
cdk deploy HivemindPrism-Network
cdk deploy HivemindPrism-Security
cdk deploy HivemindPrism-Storage
cdk deploy HivemindPrism-Intelligence
cdk deploy HivemindPrism-Compute
cdk deploy HivemindPrism-Orchestration

# Deployment will take 20-30 minutes
# Kendra index creation takes the longest (~15 minutes)
```

### 8. Verify Deployment

```bash
# List deployed stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE

# Get outputs
aws cloudformation describe-stacks --stack-name HivemindPrism-Storage --query 'Stacks[0].Outputs'

# Verify VPC
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=HivemindPrism-VPC"

# Verify S3 buckets
aws s3 ls | grep hivemind

# Verify DynamoDB tables
aws dynamodb list-tables | grep Hivemind

# Verify ECS cluster
aws ecs describe-clusters --clusters HivemindPrism

# Verify Kendra index
aws kendra list-indices

# Verify Step Functions state machine
aws stepfunctions list-state-machines | grep Hivemind
```

### 9. Install CLI Tool

```bash
# Install CLI as editable package
pip install -e ./cli

# Or install from wheel (if built)
pip install ./cli/dist/hivemind_cli-1.0.0-py3-none-any.whl

# Verify installation
hivemind --version

# Set environment variables for CLI
export HIVEMIND_UPLOADS_BUCKET=hivemind-uploads-$CDK_DEFAULT_ACCOUNT
export HIVEMIND_MISSION_TABLE=HivemindMissionStatus
export HIVEMIND_CLI_ROLE_ARN=arn:aws:iam::$CDK_DEFAULT_ACCOUNT:role/HivemindCliUserRole
```

### 10. Test the System

```bash
# Create test directory
mkdir -p /tmp/test-code
cd /tmp/test-code

# Create sample Python file
cat > app.py << 'EOF'
import os
import hashlib

def hash_password(password):
    # SECURITY ISSUE: Using MD5 for password hashing
    return hashlib.md5(password.encode()).hexdigest()

def authenticate(username, password):
    # SECURITY ISSUE: SQL injection vulnerability
    query = f"SELECT * FROM users WHERE username='{username}' AND password='{hash_password(password)}'"
    return query

if __name__ == "__main__":
    # SECURITY ISSUE: Hardcoded credentials
    api_key = "sk-1234567890abcdef"
    print(authenticate("admin", "password123"))
EOF

# Scan the code
hivemind scan --path . --repo-name "test-app" --wait

# Check status (if not using --wait)
# hivemind status --mission-id <returned-id>

# Expected result: Mission completes with 2-3 CRITICAL findings
# - MD5 password hashing
# - SQL injection
# - Hardcoded credentials
```

### 11. Configure IAM for Developers

```bash
# Create developer policy to assume CLI role
cat > developer-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::$CDK_DEFAULT_ACCOUNT:role/HivemindCliUserRole"
    }
  ]
}
EOF

# Attach to developer IAM users/roles
aws iam put-user-policy \
  --user-name developer-username \
  --policy-name HivemindCliAccess \
  --policy-document file://developer-policy.json
```

## Post-Deployment Configuration

### 1. Enable Bedrock Model Access

```bash
# Enable Claude Sonnet 4 in Bedrock console
# 1. Navigate to AWS Bedrock console
# 2. Go to Model access
# 3. Enable "Anthropic Claude Sonnet 4"
# 4. Wait for approval (usually instant)

# Verify access
aws bedrock list-foundation-models --region $AWS_DEFAULT_REGION
```

### 2. Configure Kendra Data Source

```bash
# Start initial sync of Kendra data source
KENDRA_INDEX_ID=$(aws cloudformation describe-stacks \
  --stack-name HivemindPrism-Intelligence \
  --query 'Stacks[0].Outputs[?OutputKey==`KendraIndexId`].OutputValue' \
  --output text)

aws kendra start-data-source-sync-job \
  --index-id $KENDRA_INDEX_ID \
  --id <data-source-id>
```

### 3. Subscribe to Completion Notifications

```bash
# Get SNS topic ARN
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name HivemindPrism-Orchestration \
  --query 'Stacks[0].Outputs[?OutputKey==`CompletionTopicArn`].OutputValue' \
  --output text)

# Subscribe email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription via email
```

### 4. Configure CloudWatch Alarms

```bash
# Create alarm for failed missions
aws cloudwatch put-metric-alarm \
  --alarm-name HivemindMissionFailures \
  --alarm-description "Alert on mission failures" \
  --metric-name ExecutionsFailed \
  --namespace AWS/States \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions $TOPIC_ARN
```

## Security Hardening

### 1. Rotate KMS Keys

```bash
# KMS key rotation is enabled by default (annual)
# To manually rotate:
KMS_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name HivemindPrism-Security \
  --query 'Stacks[0].Outputs[?OutputKey==`KmsKeyId`].OutputValue' \
  --output text)

aws kms enable-key-rotation --key-id $KMS_KEY_ID
```

### 2. Enable AWS Config

```bash
# Enable Config to track resource changes
aws configservice put-configuration-recorder \
  --configuration-recorder name=hivemind-config,roleARN=arn:aws:iam::$CDK_DEFAULT_ACCOUNT:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig \
  --recording-group allSupported=true,includeGlobalResourceTypes=true

aws configservice start-configuration-recorder \
  --configuration-recorder-name hivemind-config
```

### 3. Enable GuardDuty

```bash
# Enable GuardDuty for threat detection
aws guardduty create-detector --enable
```

## Monitoring & Operations

### View Logs

```bash
# View Step Functions execution
aws stepfunctions list-executions \
  --state-machine-arn <state-machine-arn> \
  --status-filter RUNNING

# View agent logs
aws logs tail /ecs/archaeologist-agent --follow

# View Lambda logs
aws logs tail /aws/lambda/HivemindUnpackAndValidate --follow
```

### Performance Monitoring

```bash
# Get mission metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/States \
  --metric-name ExecutionsSucceeded \
  --dimensions Name=StateMachineArn,Value=<arn> \
  --start-time 2025-10-19T00:00:00Z \
  --end-time 2025-10-20T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

### Cost Tracking

```bash
# View cost breakdown by service
aws ce get-cost-and-usage \
  --time-period Start=2025-10-01,End=2025-10-20 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE
```

## Troubleshooting

### Issue: Stack deployment fails

```bash
# View stack events
aws cloudformation describe-stack-events \
  --stack-name HivemindPrism-Network \
  --max-items 20

# Common issues:
# - Insufficient IAM permissions
# - Region doesn't support Bedrock/Kendra
# - ECR images not pushed
# - VPC CIDR conflicts
```

### Issue: Agent task fails to start

```bash
# Check ECS task status
aws ecs describe-tasks \
  --cluster HivemindPrism \
  --tasks <task-arn>

# Check CloudWatch logs for errors
aws logs tail /ecs/archaeologist-agent --since 1h

# Common issues:
# - IAM role lacks permissions
# - ECR image not found
# - Redis connection timeout
# - Bedrock model access not enabled
```

### Issue: CLI authentication fails

```bash
# Verify IAM permissions
aws sts get-caller-identity

# Test assume role
aws sts assume-role \
  --role-arn arn:aws:iam::$CDK_DEFAULT_ACCOUNT:role/HivemindCliUserRole \
  --role-session-name test

# Common issues:
# - User lacks sts:AssumeRole permission
# - CLI role trust policy incorrect
# - Credentials expired
```

## Cleanup

### Remove All Resources

```bash
# Delete all stacks (in reverse order)
cdk destroy HivemindPrism-Orchestration --force
cdk destroy HivemindPrism-Compute --force
cdk destroy HivemindPrism-Intelligence --force
cdk destroy HivemindPrism-Storage --force
cdk destroy HivemindPrism-Security --force
cdk destroy HivemindPrism-Network --force

# Or destroy all at once
cdk destroy --all --force

# Empty and delete S3 buckets (if needed)
aws s3 rm s3://hivemind-uploads-$CDK_DEFAULT_ACCOUNT --recursive
aws s3 rb s3://hivemind-uploads-$CDK_DEFAULT_ACCOUNT

aws s3 rm s3://hivemind-artifacts-$CDK_DEFAULT_ACCOUNT --recursive
aws s3 rb s3://hivemind-artifacts-$CDK_DEFAULT_ACCOUNT

aws s3 rm s3://hivemind-kendra-memories-$CDK_DEFAULT_ACCOUNT --recursive
aws s3 rb s3://hivemind-kendra-memories-$CDK_DEFAULT_ACCOUNT

# Delete ECR repositories
for repo in hivemind-archaeologist hivemind-strategist semgrep-mcp gitleaks-mcp trivy-mcp; do
  aws ecr delete-repository --repository-name $repo --force
done
```

## Production Considerations

### 1. High Availability

- Deploy NAT Gateways in both AZs (update CDK stack)
- Use ElastiCache cluster mode for Redis
- Enable DynamoDB Global Tables for multi-region

### 2. Performance Optimization

- Use Kendra Enterprise Edition for better performance
- Increase Fargate task resources for faster analysis
- Enable DynamoDB Auto Scaling
- Use CloudFront for static assets (if adding web UI)

### 3. Security Best Practices

- Implement VPC Flow Logs
- Enable AWS CloudTrail for all regions
- Use AWS WAF if adding API endpoints
- Implement AWS Shield for DDoS protection
- Regular security audits with AWS Security Hub

### 4. Backup and DR

- Enable S3 Cross-Region Replication
- Configure DynamoDB Point-in-Time Recovery
- Export Kendra index periodically
- Document disaster recovery procedures

## Support and Resources

- Architecture: See [DESIGN.md](DESIGN.md)
- API Specification: See [SPEC.md](SPEC.md)
- Issues: Check CloudWatch Logs
- AWS Support: Contact AWS Support for service limits

---

**Deployment Time:** ~30-40 minutes  
**Monthly Cost:** ~$900-1000 (see README.md)  
**Support:** Enterprise support recommended for production