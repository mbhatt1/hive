#!/bin/bash
set -e

# Hivemind-Prism Docker Build and Push Script
# Builds and pushes all Docker images to ECR

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REGISTRY="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

echo "Building and pushing Docker images to ECR"
echo "Registry: $ECR_REGISTRY"
echo ""

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
echo "✓ Logged in to ECR"
echo ""

# Function to build and push an image
build_and_push() {
    local name=$1
    local path=$2
    local image_name="$name"
    local full_image="$ECR_REGISTRY/$image_name:latest"
    
    echo "Building $name..."
    docker build -t "$image_name:latest" "$path"
    
    echo "Tagging $name..."
    docker tag "$image_name:latest" "$full_image"
    
    echo "Pushing $name..."
    docker push "$full_image"
    
    echo "✓ $name complete"
    echo ""
}

# Build and push agent images
echo "=== Building Agent Images ==="
build_and_push "hivemind-archaeologist" "src/agents/archaeologist"
build_and_push "hivemind-strategist" "src/agents/strategist"
build_and_push "hivemind-coordinator" "src/agents/coordinator"
build_and_push "hivemind-synthesizer" "src/agents/synthesizer"
build_and_push "hivemind-critic" "src/agents/critic"
build_and_push "hivemind-archivist" "src/agents/archivist"

# Build and push MCP server images
echo "=== Building MCP Server Images ==="
build_and_push "semgrep-mcp" "src/mcp_servers/semgrep_mcp"
build_and_push "gitleaks-mcp" "src/mcp_servers/gitleaks_mcp"
build_and_push "trivy-mcp" "src/mcp_servers/trivy_mcp"

echo ""
echo "✓ All Docker images built and pushed successfully!"
echo ""
echo "Images available at:"
for img in hivemind-archaeologist hivemind-strategist hivemind-coordinator hivemind-synthesizer hivemind-critic hivemind-archivist semgrep-mcp gitleaks-mcp trivy-mcp; do
    echo "  - $ECR_REGISTRY/$img:latest"
done
echo ""
echo "Next step: npm run deploy"