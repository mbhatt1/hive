# MCP Server Deployment Guide

This guide covers deploying and operating Model Context Protocol (MCP) servers in the Hivemind-Prism security intelligence platform.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Deployment Models](#deployment-models)
3. [Prerequisites](#prerequisites)
4. [Container Images](#container-images)
5. [AWS Deployment](#aws-deployment)
6. [Configuration](#configuration)
7. [Monitoring](#monitoring)
8. [Troubleshooting](#troubleshooting)
9. [Security](#security)
10. [Scaling](#scaling)

## Architecture Overview

### MCP in Hivemind-Prism

The system uses the **Model Context Protocol (MCP)** as defined by Anthropic. MCP enables:

- **Dynamic tool discovery** - Agents discover available tools at runtime
- **Standardized communication** - JSON-RPC 2.0 over stdio transport
- **Evidence chains** - Cryptographic integrity verification with SHA256
- **Parallel execution** - Concurrent tool invocation with semaphore control

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AWS Step Functions                       │
│                  (Orchestration Layer)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Coordinator Agent                           │
│                  (AWS Fargate Container)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Cognitive Kernel                            │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │          MCPToolRegistry                        │ │  │
│  │  │  - Manages MCP server lifecycle                 │ │  │
│  │  │  - Spawns servers as child processes            │ │  │
│  │  │  - Handles stdio JSON-RPC communication         │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│         │          │          │          │          │       │
│         ▼          ▼          ▼          ▼          ▼       │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│   │Semgrep │ │Gitleaks│ │ Trivy  │ │ScoutSte│ │  Pacu  │ │
│   │  MCP   │ │  MCP   │ │  MCP   │ │  MCP   │ │  MCP   │ │
│   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ │
│   (child    (child     (child     (child     (child       │
│   process)   process)   process)   process)   process)    │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
                ┌─────────────┐
                │  Amazon S3  │
                │ (Artifacts) │
                └─────────────┘
```

**Key Points:**

- MCP servers are **NOT** deployed as separate ECS tasks
- MCP servers are spawned as **child processes** by agent containers
- Communication uses **stdio** transport (JSON-RPC 2.0)
- All MCP server code must be bundled into agent containers

## Deployment Models

### Model 1: Bundled Deployment (Recommended)

MCP servers are included in agent container images:

**Pros:**
- Simplified deployment (single container per agent)
- No network latency (stdio communication)
- Atomic versioning (agents + tools updated together)
- Lower operational complexity

**Cons:**
- Larger container images
- Tool updates require agent redeployment

### Model 2: Separate Deployment (Not Recommended)

MCP servers run as standalone ECS tasks:

**Pros:**
- Independent tool versioning
- Smaller agent containers

**Cons:**
- Network overhead (HTTP/WebSocket transport required)
- Complex service discovery
- Higher operational complexity
- Not compatible with stdio transport

**Current Implementation:** Model 1 (Bundled Deployment)

## Prerequisites

### Required Tools

```bash
# AWS CLI
aws --version  # >= 2.0

# Docker
docker --version  # >= 20.10

# Python
python --version  # >= 3.11

# CDK
npm install -g aws-cdk
cdk --version  # >= 2.100.0
```

### AWS Permissions

Required IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition",
        "ecs:DescribeTaskDefinition",
        "ecs:RunTask",
        "ecs:DescribeTasks"
      ],
      "Resource": "*"
    }
  ]
}
```

## Container Images

### Agent Container Structure

Each agent container includes:

```
/app/
├── agent.py                    # Agent entry point
├── requirements.txt            # Agent dependencies
├── shared/                     # Shared libraries
│   ├── mcp_client/            # MCP client library
│   ├── cognitive_kernel/      # Bedrock integration
│   └── ...
└── mcp_servers/               # MCP server implementations
    ├── semgrep_mcp/
    │   ├── server.py
    │   └── requirements.txt
    ├── gitleaks_mcp/
    │   ├── server.py
    │   └── requirements.txt
    ├── trivy_mcp/
    │   ├── server.py
    │   └── requirements.txt
    ├── scoutsuite_mcp/
    │   ├── server.py
    │   └── requirements.txt
    └── pacu_mcp/
        ├── server.py
        └── requirements.txt
```

### Building Images

#### Coordinator Agent Image (includes all MCP servers)

```dockerfile
# Dockerfile for Coordinator Agent
FROM python:3.11-slim

# Install system dependencies for all tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install semgrep
RUN pip install semgrep

# Install gitleaks
RUN curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.1/gitleaks_8.18.1_linux_x64.tar.gz | \
    tar -xz -C /usr/local/bin

# Install trivy
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Copy application code
WORKDIR /app
COPY src/agents/coordinator/ /app/
COPY src/shared/ /app/shared/
COPY src/mcp_servers/ /app/mcp_servers/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir -r shared/requirements.txt
RUN pip install --no-cache-dir -r mcp_servers/semgrep_mcp/requirements.txt
RUN pip install --no-cache-dir -r mcp_servers/gitleaks_mcp/requirements.txt
RUN pip install --no-cache-dir -r mcp_servers/trivy_mcp/requirements.txt
RUN pip install --no-cache-dir -r mcp_servers/scoutsuite_mcp/requirements.txt
RUN pip install --no-cache-dir -r mcp_servers/pacu_mcp/requirements.txt

# Set environment
ENV PYTHONUNBUFFERED=1
ENV ENABLE_MCP_TOOLS=true

CMD ["python", "-u", "agent.py"]
```

#### Build and Push Script

```bash
#!/bin/bash
# scripts/build-coordinator-agent.sh

set -e

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}
IMAGE_NAME=hivemind-coordinator
ECR_REPO=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$IMAGE_NAME

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO

# Build image
docker build \
    -f src/agents/coordinator/Dockerfile \
    -t $IMAGE_NAME:latest \
    .

# Tag and push
docker tag $IMAGE_NAME:latest $ECR_REPO:latest
docker push $ECR_REPO:latest

echo "Image pushed: $ECR_REPO:latest"
```

## AWS Deployment

### Infrastructure as Code (CDK)

The CDK stacks handle deployment automatically:

```bash
# Deploy all stacks
cdk deploy --all

# Deploy specific stacks
cdk deploy HivemindPrism-Network
cdk deploy HivemindPrism-Security
cdk deploy HivemindPrism-Storage
cdk deploy HivemindPrism-Compute
cdk deploy HivemindPrism-Intelligence
cdk deploy HivemindPrism-Orchestration
```

### Manual Deployment Steps

If deploying manually:

#### 1. Create ECR Repositories

```bash
aws ecr create-repository --repository-name hivemind-coordinator
aws ecr create-repository --repository-name hivemind-synthesizer
aws ecr create-repository --repository-name hivemind-critic
aws ecr create-repository --repository-name hivemind-archaeologist
aws ecr create-repository --repository-name hivemind-strategist
aws ecr create-repository --repository-name hivemind-archivist
```

#### 2. Build and Push Images

```bash
./scripts/build-and-push-images.sh
```

#### 3. Deploy Infrastructure

```bash
cdk deploy --all --require-approval never
```

#### 4. Verify Deployment

```bash
# Check ECS cluster
aws ecs describe-clusters --clusters HivemindCluster

# List task definitions
aws ecs list-task-definitions --family-prefix hivemind

# Check Step Functions state machine
aws stepfunctions describe-state-machine \
    --state-machine-arn $(aws stepfunctions list-state-machines \
    --query "stateMachines[?name=='HivemindAgenticOrchestrator'].stateMachineArn" \
    --output text)
```

## Configuration

### Environment Variables

#### Agent Container Environment

```bash
# Mission identification
MISSION_ID=mission-12345

# AWS resources
S3_ARTIFACTS_BUCKET=hivemind-artifacts-123456789012
DYNAMODB_FINDINGS_TABLE=HivemindFindings
KENDRA_INDEX_ID=12345678-1234-1234-1234-123456789012

# MCP configuration
ENABLE_MCP_TOOLS=true
MCP_MAX_CONCURRENCY=5
MCP_TIMEOUT_SECONDS=300

# Bedrock configuration
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0

# Logging
LOG_LEVEL=INFO
```

#### MCP Server Environment

Set automatically by agents, but can be overridden:

```python
# In agent code
mcp_env = {
    'MISSION_ID': os.environ['MISSION_ID'],
    'S3_ARTIFACTS_BUCKET': os.environ['S3_ARTIFACTS_BUCKET'],
    'AWS_REGION': os.environ['AWS_REGION'],
    'LOG_LEVEL': 'DEBUG'  # Override for MCP servers
}
```

### Task Definition Configuration

```typescript
// infrastructure/stacks/compute-stack.ts

const coordinatorTask = new ecs.FargateTaskDefinition(this, 'CoordinatorTask', {
  memoryLimitMiB: 8192,  // 8GB for coordinator + MCP servers
  cpu: 4096,             // 4 vCPUs
  taskRole: coordinatorRole,
  executionRole: executionRole,
});

coordinatorTask.addContainer('coordinator', {
  image: ecs.ContainerImage.fromEcrRepository(coordinatorRepo),
  logging: ecs.LogDriver.awsLogs({
    streamPrefix: 'coordinator',
    logRetention: logs.RetentionDays.ONE_WEEK,
  }),
  environment: {
    ENABLE_MCP_TOOLS: 'true',
    MCP_MAX_CONCURRENCY: '5',
  },
  secrets: {
    // Sensitive configuration from Secrets Manager
  },
});
```

## Monitoring

### CloudWatch Metrics

Key metrics to monitor:

```python
# Custom metrics emitted by agents
cloudwatch.put_metric_data(
    Namespace='Hivemind/MCP',
    MetricData=[
        {
            'MetricName': 'MCPToolInvocations',
            'Value': 1,
            'Unit': 'Count',
            'Dimensions': [
                {'Name': 'ServerName', 'Value': 'semgrep-mcp'},
                {'Name': 'ToolName', 'Value': 'semgrep_scan'},
            ]
        },
        {
            'MetricName': 'MCPToolDuration',
            'Value': duration_ms,
            'Unit': 'Milliseconds',
            'Dimensions': [
                {'Name': 'ServerName', 'Value': 'semgrep-mcp'},
            ]
        },
        {
            'MetricName': 'MCPToolErrors',
            'Value': 1 if error else 0,
            'Unit': 'Count',
            'Dimensions': [
                {'Name': 'ServerName', 'Value': 'semgrep-mcp'},
                {'Name': 'ErrorType', 'Value': error_type},
            ]
        }
    ]
)
```

### CloudWatch Logs

Log groups created automatically:

```
/aws/ecs/hivemind-coordinator
/aws/ecs/hivemind-synthesizer
/aws/ecs/hivemind-critic
/aws/stepfunctions/HivemindOrchestrator
```

Query logs:

```bash
# View coordinator logs
aws logs tail /aws/ecs/hivemind-coordinator --follow

# Search for MCP errors
aws logs filter-log-events \
    --log-group-name /aws/ecs/hivemind-coordinator \
    --filter-pattern "ERROR MCP"
```

### CloudWatch Alarms

Pre-configured alarms:

- **Task Failures** - ECS task exits with non-zero code
- **Execution Failures** - Step Functions execution fails
- **Long Running** - Execution exceeds 45 minutes
- **Memory Usage** - Container memory exceeds 80%
- **CPU Usage** - Container CPU exceeds 80%

## Troubleshooting

### Common Issues

#### 1. MCP Server Not Found

**Symptom:**
```
FileNotFoundError: [Errno 2] No such file or directory: 'python'
```

**Solution:**
Ensure Python and MCP server scripts are in the container image:

```dockerfile
# Verify in Dockerfile
COPY src/mcp_servers/ /app/mcp_servers/
RUN pip install -r mcp_servers/semgrep_mcp/requirements.txt
```

#### 2. JSON-RPC Communication Failure

**Symptom:**
```
ERROR: MCP server did not respond to initialization
```

**Solution:**
Check MCP server logs and verify JSON-RPC protocol:

```python
# Enable debug logging
import logging
logging.basicConfig(level=logging.DEBUG)
```

#### 3. Memory Exhaustion

**Symptom:**
```
Task stopped (Essential container in task exited)
Exit Code: 137 (OOM killed)
```

**Solution:**
Increase task memory or reduce MCP concurrency:

```typescript
memoryLimitMiB: 16384,  // Increase to 16GB
```

```python
# Reduce concurrency
await kernel.invoke_mcp_tools_parallel(
    invocations,
    max_concurrency=2  # Reduce from 5 to 2
)
```

#### 4. Tool Dependencies Missing

**Symptom:**
```
FileNotFoundError: semgrep: command not found
```

**Solution:**
Install tool in Dockerfile:

```dockerfile
RUN pip install semgrep
# OR for binary tools
RUN curl -sSfL ... | tar -xz -C /usr/local/bin
```

### Debug Mode

Enable debug logging:

```python
# src/agents/coordinator/agent.py
import logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

### Testing MCP Servers Locally

Test MCP servers outside of ECS:

```bash
# Set environment
export MISSION_ID=test-123
export S3_ARTIFACTS_BUCKET=test-bucket

# Run MCP server
python src/mcp_servers/semgrep_mcp/server.py

# Test with MCP client
python -c "
import asyncio
from src.shared.mcp_client.client import MCPToolClient

async def test():
    async with MCPToolClient(
        'semgrep-mcp',
        ['python', 'src/mcp_servers/semgrep_mcp/server.py']
    ) as client:
        tools = await client.list_tools()
        print(f'Available tools: {tools}')

asyncio.run(test())
"
```

## Security

### IAM Roles

Each agent has specific IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::hivemind-artifacts-*/*",
        "arn:aws:s3:::hivemind-artifacts-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/HivemindFindings"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.claude-*"
    }
  ]
}
```

### Network Security

- Agents run in **private subnets** with NAT Gateway
- No direct internet access
- VPC endpoints for AWS services
- Security groups restrict inter-service communication

### Secrets Management

Use AWS Secrets Manager for sensitive data:

```typescript
const apiKeySecret = secretsmanager.Secret.fromSecretNameV2(
  this,
  'ApiKey',
  'hivemind/api-keys'
);

taskDefinition.addContainer('coordinator', {
  secrets: {
    API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret),
  },
});
```

## Scaling

### Horizontal Scaling

Step Functions orchestrates multiple concurrent missions:

```typescript
// No explicit scaling needed - Step Functions manages concurrency
// ECS Fargate auto-scales based on task demand
```

### Vertical Scaling

Adjust task resources based on workload:

```typescript
// For code-heavy scans
const coordinatorTask = new ecs.FargateTaskDefinition(this, 'CoordinatorTask', {
  memoryLimitMiB: 16384,  // 16GB
  cpu: 8192,              // 8 vCPUs
});

// For AWS scans (lighter workload)
const coordinatorTask = new ecs.FargateTaskDefinition(this, 'CoordinatorTask', {
  memoryLimitMiB: 4096,   // 4GB
  cpu: 2048,              // 2 vCPUs
});
```

### MCP Concurrency Tuning

```python
# Low memory: reduce concurrency
await kernel.invoke_mcp_tools_parallel(
    invocations,
    max_concurrency=2
)

# High memory: increase concurrency
await kernel.invoke_mcp_tools_parallel(
    invocations,
    max_concurrency=10
)
```

## Related Documentation

- [MCP Implementation Guide](MCP_IMPLEMENTATION_GUIDE.md)
- [MCP Implementation Status](MCP_IMPLEMENTATION_STATUS.md)
- [Testing Guide](TESTING.md)
- [Deployment Guide](DEPLOYMENT.md)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)

## Support

For issues or questions:

1. Check CloudWatch Logs
2. Review [Troubleshooting](#troubleshooting) section
3. Run integration tests: `pytest tests/integration/ -v`
4. Check MCP protocol compliance: `pytest tests/integration/test_mcp_protocol.py::TestMCPServerCompliance -v`