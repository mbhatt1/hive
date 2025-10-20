#!/bin/bash
# Create ECR repositories for AWS security scanning MCP servers

set -e

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}

echo "Creating ECR repositories for AWS MCP servers..."
echo "Account: $AWS_ACCOUNT_ID"
echo "Region: $AWS_REGION"

# Create repositories for AWS security tools
REPOS=("scoutsuite-mcp" "pacu-mcp")

for REPO in "${REPOS[@]}"; do
    echo ""
    echo "Creating repository: $REPO"
    
    # Check if repository exists
    if aws ecr describe-repositories --repository-names "$REPO" --region "$AWS_REGION" 2>/dev/null; then
        echo "Repository $REPO already exists"
    else
        # Create repository
        aws ecr create-repository \
            --repository-name "$REPO" \
            --region "$AWS_REGION" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256 \
            --tags Key=Project,Value=HivemindPrism Key=ManagedBy,Value=Terraform
        
        echo "Created repository: $REPO"
    fi
    
    # Set lifecycle policy to keep only last 10 images
    aws ecr put-lifecycle-policy \
        --repository-name "$REPO" \
        --region "$AWS_REGION" \
        --lifecycle-policy-text '{
            "rules": [
                {
                    "rulePriority": 1,
                    "description": "Keep only 10 most recent images",
                    "selection": {
                        "tagStatus": "any",
                        "countType": "imageCountMoreThan",
                        "countNumber": 10
                    },
                    "action": {
                        "type": "expire"
                    }
                }
            ]
        }'
    
    echo "Set lifecycle policy for $REPO"
done

echo ""
echo "✅ All AWS MCP repositories created successfully!"
echo ""
echo "Next steps:"
echo "1. Build Docker images for scoutsuite-mcp and pacu-mcp"
echo "2. Run: ./scripts/build-and-push-aws-images.sh"