#!/bin/bash

# Hivemind-Prism Pre-Deployment Validation Script
# Checks all prerequisites before CDK deployment

set -e

echo "=========================================="
echo "Hivemind-Prism Pre-Deployment Validation"
echo "=========================================="
echo ""

ERRORS=0
WARNINGS=0

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 is installed"
        return 0
    else
        echo -e "${RED}✗${NC} $1 is NOT installed"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

check_aws_auth() {
    if aws sts get-caller-identity &> /dev/null; then
        ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        echo -e "${GREEN}✓${NC} AWS credentials configured (Account: $ACCOUNT_ID)"
        return 0
    else
        echo -e "${RED}✗${NC} AWS credentials NOT configured"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

check_docker_running() {
    if docker info &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker is running"
        return 0
    else
        echo -e "${RED}✗${NC} Docker is NOT running"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

check_ecr_repos() {
    local repos=("hivemind-archaeologist" "hivemind-strategist" "hivemind-coordinator" "hivemind-synthesizer" "hivemind-critic" "hivemind-archivist" "semgrep-mcp" "gitleaks-mcp" "trivy-mcp")
    local missing=0
    
    for repo in "${repos[@]}"; do
        if aws ecr describe-repositories --repository-names "$repo" &> /dev/null; then
            # Check if image exists
            if aws ecr describe-images --repository-name "$repo" --image-ids imageTag=latest &> /dev/null; then
                continue
            else
                echo -e "${YELLOW}⚠${NC} ECR repository $repo exists but has no 'latest' image"
                missing=$((missing + 1))
            fi
        else
            echo -e "${YELLOW}⚠${NC} ECR repository $repo does not exist"
            missing=$((missing + 1))
        fi
    done
    
    if [ $missing -eq 0 ]; then
        echo -e "${GREEN}✓${NC} All ECR repositories exist with images"
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $missing ECR repositories missing or without images"
        WARNINGS=$((WARNINGS + 1))
        return 1
    fi
}

check_lambda_assets() {
    local missing=0
    
    for lambda_dir in src/lambdas/*/; do
        lambda_name=$(basename "$lambda_dir")
        if [ ! -f "$lambda_dir/index.py" ]; then
            echo -e "${RED}✗${NC} Lambda $lambda_name missing index.py"
            missing=$((missing + 1))
        fi
        if [ ! -f "$lambda_dir/requirements.txt" ]; then
            echo -e "${YELLOW}⚠${NC} Lambda $lambda_name missing requirements.txt"
            WARNINGS=$((WARNINGS + 1))
        fi
    done
    
    if [ $missing -eq 0 ]; then
        echo -e "${GREEN}✓${NC} All Lambda functions have required files"
        return 0
    else
        echo -e "${RED}✗${NC} $missing Lambda functions missing required files"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

check_agent_dockerfiles() {
    local missing=0
    
    for agent_dir in src/agents/*/; do
        agent_name=$(basename "$agent_dir")
        if [ ! -f "$agent_dir/Dockerfile" ]; then
            echo -e "${RED}✗${NC} Agent $agent_name missing Dockerfile"
            missing=$((missing + 1))
        fi
        if [ ! -f "$agent_dir/agent.py" ]; then
            echo -e "${RED}✗${NC} Agent $agent_name missing agent.py"
            missing=$((missing + 1))
        fi
    done
    
    if [ $missing -eq 0 ]; then
        echo -e "${GREEN}✓${NC} All agents have required files"
        return 0
    else
        echo -e "${RED}✗${NC} $missing agents missing required files"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

echo "Checking prerequisites..."
echo ""

# Check commands
check_command "node"
check_command "npm"
check_command "aws"
check_command "cdk"
check_command "docker"
check_command "python3"

echo ""

# Check AWS authentication
check_aws_auth

echo ""

# Check Docker
check_docker_running

echo ""

# Check ECR repositories
echo "Checking ECR repositories..."
check_ecr_repos

echo ""

# Check Lambda assets
echo "Checking Lambda functions..."
check_lambda_assets

echo ""

# Check Agent Dockerfiles
echo "Checking Agent Dockerfiles..."
check_agent_dockerfiles

echo ""
echo "=========================================="
echo "Validation Summary"
echo "=========================================="
echo -e "Errors: ${RED}$ERRORS${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}✗ Pre-deployment validation FAILED${NC}"
    echo ""
    echo "Fix the errors above before deploying."
    echo ""
    echo "Common fixes:"
    echo "  - Run: ./scripts/create-ecr-repos.sh"
    echo "  - Run: ./scripts/build-and-push-images.sh"
    echo "  - Ensure Docker is running"
    echo "  - Configure AWS credentials: aws configure"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠ Pre-deployment validation passed with warnings${NC}"
    echo ""
    echo "You can proceed, but review the warnings above."
    echo ""
    echo "To fix warnings:"
    echo "  - Run: ./scripts/create-ecr-repos.sh"
    echo "  - Run: ./scripts/build-and-push-images.sh"
    exit 0
else
    echo -e "${GREEN}✓ Pre-deployment validation PASSED${NC}"
    echo ""
    echo "You can now run: npm run deploy"
    exit 0
fi