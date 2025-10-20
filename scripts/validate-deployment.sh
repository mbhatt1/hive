#!/bin/bash

###############################################################################
# Hivemind-Prism Pre-Deployment Validation Script
# 
# This script validates that all required files exist and the system is ready
# for CDK deployment.
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================================="
echo "Hivemind-Prism Pre-Deployment Validation"
echo "=================================================="
echo ""

# Track validation status
VALIDATION_PASSED=true

# Function to check file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        return 0
    else
        echo -e "${RED}✗${NC} $1 (MISSING)"
        VALIDATION_PASSED=false
        return 1
    fi
}

# Function to check directory exists
check_dir() {
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1/"
        return 0
    else
        echo -e "${RED}✗${NC} $1/ (MISSING)"
        VALIDATION_PASSED=false
        return 1
    fi
}

echo "1. Checking CDK Infrastructure Files..."
echo "----------------------------------------"
check_file "cdk.json"
check_file "package.json"
check_file "tsconfig.json"
check_file "bin/app.ts"
check_file "infrastructure/stacks/network-stack.ts"
check_file "infrastructure/stacks/security-stack.ts"
check_file "infrastructure/stacks/storage-stack.ts"
check_file "infrastructure/stacks/intelligence-stack.ts"
check_file "infrastructure/stacks/compute-stack.ts"
check_file "infrastructure/stacks/orchestration-stack.ts"
echo ""

echo "2. Checking Agent Dockerfiles..."
echo "----------------------------------------"
check_file "src/agents/archaeologist/Dockerfile"
check_file "src/agents/strategist/Dockerfile"
check_file "src/agents/coordinator/Dockerfile"
check_file "src/agents/synthesizer/Dockerfile"
check_file "src/agents/critic/Dockerfile"
check_file "src/agents/archivist/Dockerfile"
echo ""

echo "3. Checking Agent Requirements..."
echo "----------------------------------------"
check_file "src/agents/archaeologist/requirements.txt"
check_file "src/agents/strategist/requirements.txt"
check_file "src/agents/coordinator/requirements.txt"
check_file "src/agents/synthesizer/requirements.txt"
check_file "src/agents/critic/requirements.txt"
check_file "src/agents/archivist/requirements.txt"
echo ""

echo "4. Checking Agent Code..."
echo "----------------------------------------"
check_file "src/agents/archaeologist/agent.py"
check_file "src/agents/strategist/agent.py"
check_file "src/agents/coordinator/agent.py"
check_file "src/agents/synthesizer/agent.py"
check_file "src/agents/critic/agent.py"
check_file "src/agents/archivist/agent.py"
echo ""

echo "5. Checking MCP Server Files..."
echo "----------------------------------------"
check_file "src/mcp-servers/semgrep-mcp/Dockerfile"
check_file "src/mcp-servers/semgrep-mcp/server.py"
check_file "src/mcp-servers/semgrep-mcp/requirements.txt"
check_file "src/mcp-servers/gitleaks-mcp/Dockerfile"
check_file "src/mcp-servers/gitleaks-mcp/server.py"
check_file "src/mcp-servers/gitleaks-mcp/requirements.txt"
check_file "src/mcp-servers/trivy-mcp/Dockerfile"
check_file "src/mcp-servers/trivy-mcp/server.py"
check_file "src/mcp-servers/trivy-mcp/requirements.txt"
echo ""

echo "6. Checking Lambda Functions..."
echo "----------------------------------------"
check_file "src/lambdas/unpack/index.py"
check_file "src/lambdas/unpack/requirements.txt"
check_file "src/lambdas/memory-ingestor/index.py"
check_file "src/lambdas/memory-ingestor/requirements.txt"
check_file "src/lambdas/failure-handler/index.py"
check_file "src/lambdas/failure-handler/requirements.txt"
echo ""

echo "7. Checking Shared Libraries..."
echo "----------------------------------------"
check_file "src/shared/__init__.py"
check_file "src/shared/requirements.txt"
check_file "src/shared/cognitive_kernel/__init__.py"
check_file "src/shared/cognitive-kernel/bedrock_client.py"
check_file "src/shared/code_research/__init__.py"
check_file "src/shared/code-research/deep_researcher.py"
check_file "src/shared/documentation/__init__.py"
check_file "src/shared/documentation/wiki_generator.py"
echo ""

echo "8. Checking CLI Tool..."
echo "----------------------------------------"
check_file "cli/hivemind_cli/cli.py"
echo ""

echo "9. Checking Test Infrastructure..."
echo "----------------------------------------"
check_file "pytest.ini"
check_file "requirements-test.txt"
check_file "tests/conftest.py"
check_dir "tests/unit/agents"
check_dir "tests/unit/mcp_servers"
check_dir "tests/unit/lambdas"
check_dir "tests/unit/shared"
echo ""

echo "10. Checking Documentation..."
echo "----------------------------------------"
check_file "README.md"
check_file "DESIGN.md"
check_file "SPEC.md"
check_file "DEPLOYMENT.md"
check_file "TESTING.md"
check_file "DEPLOYMENT_READINESS.md"
echo ""

echo "11. Testing CDK Synthesis..."
echo "----------------------------------------"
if command -v npm &> /dev/null; then
    if [ -d "node_modules" ]; then
        echo -e "${GREEN}✓${NC} node_modules installed"
    else
        echo -e "${YELLOW}⚠${NC} Running npm install..."
        npm install
    fi
    
    echo "Running: npm run build"
    if npm run build > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} TypeScript compilation successful"
    else
        echo -e "${RED}✗${NC} TypeScript compilation failed"
        VALIDATION_PASSED=false
    fi
    
    echo "Running: cdk synth"
    if npx cdk synth > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} CDK synthesis successful"
    else
        echo -e "${RED}✗${NC} CDK synthesis failed"
        VALIDATION_PASSED=false
    fi
else
    echo -e "${YELLOW}⚠${NC} npm not found, skipping CDK synthesis test"
fi
echo ""

echo "12. Counting Test Files..."
echo "----------------------------------------"
AGENT_TESTS=$(find tests/unit/agents -name "test_*.py" 2>/dev/null | wc -l)
MCP_TESTS=$(find tests/unit/mcp_servers -name "test_*.py" 2>/dev/null | wc -l)
LAMBDA_TESTS=$(find tests/unit/lambdas -name "test_*.py" 2>/dev/null | wc -l)
SHARED_TESTS=$(find tests/unit/shared -name "test_*.py" 2>/dev/null | wc -l)
TOTAL_TESTS=$((AGENT_TESTS + MCP_TESTS + LAMBDA_TESTS + SHARED_TESTS))

echo "Agent tests: $AGENT_TESTS"
echo "MCP server tests: $MCP_TESTS"
echo "Lambda tests: $LAMBDA_TESTS"
echo "Shared library tests: $SHARED_TESTS"
echo -e "${GREEN}Total test files: $TOTAL_TESTS${NC}"
echo ""

# Final validation result
echo "=================================================="
if [ "$VALIDATION_PASSED" = true ]; then
    echo -e "${GREEN}✓ VALIDATION PASSED${NC}"
    echo ""
    echo "System is ready for deployment!"
    echo ""
    echo "To deploy:"
    echo "  1. Configure AWS credentials"
    echo "  2. Run: cdk bootstrap (first time only)"
    echo "  3. Run: cdk deploy --all"
    echo ""
    echo "To run tests:"
    echo "  1. Install test dependencies: pip install -r requirements-test.txt"
    echo "  2. Run tests: pytest tests/ -v"
    echo "  3. With coverage: pytest tests/ --cov=src --cov-report=html"
    echo ""
    exit 0
else
    echo -e "${RED}✗ VALIDATION FAILED${NC}"
    echo ""
    echo "Please fix the missing files before deploying."
    echo ""
    exit 1
fi