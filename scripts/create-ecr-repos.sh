#!/bin/bash
set -e

# Hivemind-Prism ECR Repository Creation Script
# This script creates all required ECR repositories for agents and MCP servers

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"

echo "Creating ECR repositories in region: $AWS_REGION"
echo "AWS Account: $AWS_ACCOUNT_ID"
echo ""

# List of repositories to create
REPOSITORIES=(
    "hivemind-archaeologist"
    "hivemind-strategist"
    "hivemind-coordinator"
    "hivemind-synthesizer"
    "hivemind-critic"
    "hivemind-archivist"
    "semgrep-mcp"
    "gitleaks-mcp"
    "trivy-mcp"
)

# Create each repository
for repo in "${REPOSITORIES[@]}"; do
    echo "Creating repository: $repo"
    
    if aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" &>/dev/null; then
        echo "  ✓ Repository $repo already exists"
    else
        aws ecr create-repository \
            --repository-name "$repo" \
            --region "$AWS_REGION" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration encryptionType=AES256 \
            --tags Key=Project,Value=Hivemind-Prism Key=ManagedBy,Value=Script
        echo "  ✓ Repository $repo created"
    fi
done

echo ""
echo "✓ All ECR repositories created successfully!"
echo ""
echo "Next steps:"
echo "1. Run: ./scripts/build-and-push-images.sh"
echo "2. Then: npm run deploy"