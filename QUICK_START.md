# Quick Start Guide - Hivemind-Prism Deployment

## ⚠️ Important: Run Commands from Project Root

All CDK and deployment commands **must** be run from the project root directory where `cdk.json` is located, **NOT** from subdirectories like `src/`.

```bash
# If you're in a subdirectory, go back to root:
cd /Users/mbhatt/AutoGPT-Next-Web

# Verify you're in the right place:
ls cdk.json  # Should exist
```

---

## Step-by-Step Deployment

### 1. Navigate to Project Root
```bash
cd /Users/mbhatt/AutoGPT-Next-Web
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Environment Variables
```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT_ID
export CDK_DEFAULT_REGION=$AWS_REGION
```

### 4. Validate Prerequisites
```bash
./scripts/validate-pre-deployment.sh
```

### 5. Bootstrap CDK (First Time Only)
```bash
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$CDK_DEFAULT_REGION
```

### 6. Create ECR Repositories
```bash
./scripts/create-ecr-repos.sh
```

### 7. Build and Push Docker Images
```bash
./scripts/build-and-push-images.sh
# This takes ~10-15 minutes
```

### 8. Synthesize CloudFormation (Optional - for review)
```bash
npx cdk synth
```

### 9. Deploy All Stacks
```bash
npx cdk deploy --all --require-approval never
# Or use: npm run deploy
# This takes ~35-40 minutes
```

---

## Common Issues

### Issue: "command not found: cdk"
**Solution**: Use `npx cdk` instead of just `cdk`, or install globally:
```bash
npm install -g aws-cdk
```

### Issue: "--app is required"
**Solution**: You're not in the project root directory. Run:
```bash
cd /Users/mbhatt/AutoGPT-Next-Web
ls cdk.json  # Verify cdk.json exists
```

### Issue: "Specify an environment name"
**Solution**: Set environment variables first:
```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=us-east-1
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

### Issue: "AWS credentials not configured"
**Solution**: Configure AWS CLI:
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output format (json)
```

### Issue: "Docker daemon not running"
**Solution**: Start Docker Desktop and wait for it to fully start

---

## Verify Deployment

After deployment completes (~40 min), verify:

```bash
# Check stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE | grep HivemindPrism

# Check S3 buckets
aws s3 ls | grep hivemind

# Check DynamoDB tables
aws dynamodb list-tables | grep Hivemind

# Check ECS cluster
aws ecs describe-clusters --clusters HivemindPrism

# Check Kendra index
aws kendra list-indices
```

---

## Quick Reference

### Project Structure
```
/Users/mbhatt/AutoGPT-Next-Web/    ← RUN COMMANDS FROM HERE
├── cdk.json                        ← CDK configuration
├── bin/app.ts                      ← CDK app entry point
├── infrastructure/                 ← CDK stacks
├── src/                            ← Application code
├── scripts/                        ← Deployment scripts
└── package.json                    ← NPM dependencies
```

### Available NPM Scripts
```bash
npm run synth        # Synthesize CloudFormation
npm run deploy       # Deploy all stacks
npm run destroy      # Destroy all stacks
npm run test         # Run tests
```

### Environment Variables Needed
```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_ACCOUNT=$AWS_ACCOUNT_ID
export CDK_DEFAULT_REGION=$AWS_REGION
```

---

## Post-Deployment

1. **Enable Bedrock Model Access**
   - Go to AWS Console → Bedrock → Model access
   - Enable "Anthropic Claude Sonnet 4"

2. **Subscribe to SNS Notifications**
   ```bash
   TOPIC_ARN=$(aws cloudformation describe-stacks \
     --stack-name HivemindPrism-Orchestration \
     --query 'Stacks[0].Outputs[?OutputKey==`CompletionTopicArn`].OutputValue' \
     --output text)
   
   aws sns subscribe \
     --topic-arn $TOPIC_ARN \
     --protocol email \
     --notification-endpoint your-email@example.com
   ```

3. **Install CLI Tool**
   ```bash
   pip install -e ./cli
   hivemind --version
   ```

---

## Next Steps

Once deployed, test the system:

```bash
# Create test code
mkdir -p /tmp/test-code
cd /tmp/test-code

cat > app.py << 'EOF'
import os
import hashlib

def hash_password(password):
    # SECURITY ISSUE: Using MD5 for password hashing
    return hashlib.md5(password.encode()).hexdigest()

api_key = "sk-1234567890abcdef"  # SECURITY ISSUE: Hardcoded credentials
EOF

# Scan with Hivemind
hivemind scan --path . --repo-name "test-app" --wait
```

---

## Need Help?

1. Check [`DEPLOYMENT.md`](DEPLOYMENT.md) for detailed instructions
2. Check [`DEPLOYMENT_FIXES.md`](DEPLOYMENT_FIXES.md) for what was fixed
3. Run `./scripts/validate-pre-deployment.sh` to diagnose issues
4. Check CloudWatch Logs if deployment fails
5. Review CloudFormation events in AWS Console

---

## Estimated Costs

- **Total**: ~$200-300/month
- Kendra Enterprise: ~$1,008/month (can use Developer edition for ~$1/month if testing)
- ElastiCache Redis: ~$25/month
- NAT Gateway: ~$32/month
- VPC Endpoints: ~$30/month
- Other services: Usage-based

---

*Always run commands from: `/Users/mbhatt/AutoGPT-Next-Web`*