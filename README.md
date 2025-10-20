# Hivemind-Prism: Agentic Security Intelligence Platform

## Overview

Hivemind-Prism is a fully autonomous multi-agent security intelligence platform that analyzes code securely without exposed APIs, using event-driven coordination between specialized AI agents powered by Amazon Bedrock.

## Architecture

The system implements a serverless, event-driven architecture with:
- **Zero API Gateway**: Direct IAM-authenticated S3 uploads
- **6 Specialized AI Agents**: Autonomous decision-making with Bedrock
- **MCP Tool Servers**: Pluggable security analysis tools
- **RAG-Powered Memory**: Amazon Kendra for institutional learning
- **Cryptographic Evidence Chain**: Non-repudiable finding verification

## Project Structure

```
hivemind-prism/
├── bin/
│   └── app.ts                          # CDK app entry point
├── infrastructure/
│   └── stacks/
│       ├── network-stack.ts            # VPC, subnets, endpoints
│       ├── security-stack.ts           # KMS, IAM, security groups
│       ├── storage-stack.ts            # S3, DynamoDB, ElastiCache
│       ├── intelligence-stack.ts       # Bedrock, Kendra
│       ├── compute-stack.ts            # ECS, Fargate, Lambda
│       └── orchestration-stack.ts      # Step Functions, EventBridge
├── src/
│   ├── agents/                         # AI Agent implementations
│   │   ├── archaeologist/              # Context discovery
│   │   ├── strategist/                 # Planning & tool selection
│   │   ├── coordinator/                # Resource allocation
│   │   ├── synthesizer/                # Finding generation
│   │   ├── critic/                     # Validation & challenge
│   │   └── archivist/                  # Final storage
│   ├── mcp-servers/                    # MCP tool implementations
│   │   ├── semgrep-mcp/                # Static analysis
│   │   ├── gitleaks-mcp/               # Secret scanning
│   │   └── trivy-mcp/                  # Dependency scanning
│   ├── lambdas/                        # Lambda functions
│   │   ├── unpack/                     # Code extraction & validation
│   │   ├── memory-ingestor/            # Kendra document creation
│   │   └── failure-handler/            # Error handling
│   └── shared/                         # Shared libraries
│       ├── cognitive-kernel/           # Bedrock integration
│       ├── negotiation-protocol/       # Agent communication
│       └── models/                     # Data models
├── cli/                                # Python CLI tool
│   └── hivemind_cli/
│       ├── __init__.py
│       ├── cli.py
│       ├── uploader.py
│       ├── archive.py
│       └── auth.py
├── DESIGN.md                           # Detailed architecture
├── SPEC.md                             # Technical specification
├── package.json
├── tsconfig.json
└── cdk.json
```

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI configured
- Node.js 18+ and npm
- Python 3.12+
- Docker (for building agent/MCP containers)
- AWS CDK CLI: `npm install -g aws-cdk`

## Installation

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Python CLI dependencies
pip install -e ./cli
```

### 2. Configure AWS Credentials

```bash
aws configure
# Or set environment variables:
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=us-east-1
```

### 3. Bootstrap CDK (first time only)

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

## Deployment

### Deploy All Stacks

```bash
npm run deploy
```

### Deploy Individual Stacks

```bash
cdk deploy HivemindPrism-Network
cdk deploy HivemindPrism-Security
cdk deploy HivemindPrism-Storage
cdk deploy HivemindPrism-Intelligence
cdk deploy HivemindPrism-Compute
cdk deploy HivemindPrism-Orchestration
```

### View Deployment Plan

```bash
npm run synth
```

## Usage

### CLI Tool

```bash
# Scan local code
hivemind scan --path ./my-project --repo-name "my-service"

# Scan with wait for completion
hivemind scan --path . --repo-name "auth-service" --wait

# Check mission status
hivemind status --mission-id abc-123-def

# Get findings
hivemind get-findings --mission-id abc-123-def --format json
```

### Workflow

1. **Developer uploads code**: `hivemind scan --path .`
2. **CLI assumes role**: Gets temporary credentials via STS
3. **Direct S3 upload**: Secure, IAM-signed upload to S3
4. **S3 Event triggers**: EventBridge → Step Functions
5. **Agent orchestration**: 6 agents analyze in parallel/sequence
6. **MCP tools execute**: Security scanning (semgrep, gitleaks, etc.)
7. **AI synthesis**: Bedrock-powered finding generation
8. **Agent negotiation**: Multi-agent consensus via ElastiCache
9. **Archive & learn**: DynamoDB + Kendra memory formation
10. **Results available**: Query via CLI or API

## Security Features

### Encryption
- **At Rest**: KMS-encrypted S3, DynamoDB, ElastiCache
- **In Transit**: TLS 1.2+ for all connections via VPC endpoints
- **Keys**: Customer-managed KMS key with automatic rotation

### Network Isolation
- **No API Gateway**: Zero public endpoints
- **VPC Isolation**: All compute in private subnets
- **VPC Endpoints**: AWS service access without internet
- **Security Groups**: Least-privilege network access

### IAM & Access Control
- **Least Privilege**: Minimal IAM policies per role
- **Temporary Credentials**: STS AssumeRole for CLI
- **Service Principals**: AWS service-to-service auth only
- **No Hard-coded Secrets**: Secrets Manager for credentials

### Audit & Compliance
- **CloudTrail**: All API calls logged
- **Evidence Chain**: Cryptographic SHA256 linking
- **Non-repudiation**: Immutable finding records
- **Retention**: Configurable TTL on all data

## Architecture Highlights

### Zero API Gateway Design

Traditional approach:
```
Developer → API Gateway → Lambda → S3
```

Hivemind-Prism approach:
```
Developer → IAM AssumeRole → Direct S3 Upload → EventBridge → Step Functions
```

Benefits:
- **Lower cost**: No API Gateway charges
- **Better security**: No public endpoints
- **Simpler auth**: Pure IAM
- **Higher throughput**: Direct S3 upload

### Agent Autonomy Model

Each agent follows SENSE → THINK → DECIDE → ACT → REFLECT loop:

1. **SENSE**: Read mission state from ElastiCache + Kendra
2. **THINK**: Bedrock invocation with context
3. **DECIDE**: Select action based on confidence
4. **ACT**: Execute and write results
5. **REFLECT**: Update confidence scores

### Negotiation Protocol

```
SynthesizerAgent: "SQL Injection CRITICAL (0.87)"
      ↓
CriticAgent: "Counter: HIGH (0.72)" + evidence
      ↓
Both query Kendra: "SQL injection patterns"
      ↓
Kendra: "Line 42 unprotected, CRITICAL confirmed"
      ↓
Consensus: CRITICAL (synthesizer: 0.87, critic: 0.91)
```

## Cost Optimization

### Estimated Monthly Costs (light usage)

- **VPC**: Free (VPC endpoints: ~$22/month)
- **S3**: ~$5/month (100GB storage)
- **DynamoDB**: ~$2/month (on-demand)
- **ElastiCache**: ~$12/month (t3.micro)
- **Kendra**: ~$810/month (Developer Edition)
- **Fargate**: ~$10-50/month (ephemeral tasks)
- **Bedrock**: ~$20-100/month (usage-based)
- **Lambda**: ~$1/month
- **Data Transfer**: ~$5/month

**Total**: ~$900-1000/month

### Cost Reduction Strategies

1. Use single NAT Gateway (done)
2. On-demand DynamoDB pricing (done)
3. S3 lifecycle policies (done)
4. ElastiCache t3.micro (done)
5. Fargate Spot pricing (optional)
6. Kendra Developer Edition (done)

## Monitoring & Observability

### CloudWatch Metrics

- Mission completion rate
- Agent execution duration
- Tool success/failure rate
- Finding count per severity
- Kendra query latency

### CloudWatch Logs

- `/ecs/archaeologist-agent`
- `/ecs/strategist-agent`
- `/ecs/synthesizer-agent`
- `/aws/lambda/UnpackLambda`
- `/aws/stepfunctions/AgenticOrchestrator`

### X-Ray Tracing

- Distributed tracing enabled on all agents
- Lambda function tracing
- Service map visualization

## Development

### Build Agents

```bash
cd src/agents/archaeologist
docker build -t hivemind-archaeologist:latest .
docker tag hivemind-archaeologist:latest $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/hivemind-archaeologist:latest
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/hivemind-archaeologist:latest
```

### Build MCP Servers

```bash
cd src/mcp-servers/semgrep-mcp
docker build -t semgrep-mcp:latest .
docker tag semgrep-mcp:latest $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/semgrep-mcp:latest
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/semgrep-mcp:latest
```

### Run Tests

```bash
npm test
```

### Local Development

```bash
# Watch mode for CDK changes
npm run watch
```

## Troubleshooting

### Issue: Mission stuck in PENDING

**Solution**: Check EventBridge rule and Step Functions execution:
```bash
aws events list-rules --name-prefix Hivemind
aws stepfunctions list-executions --state-machine-arn <ARN>
```

### Issue: Agent task fails to start

**Solution**: Check ECS task logs and IAM permissions:
```bash
aws logs tail /ecs/archaeologist-agent --follow
aws iam simulate-principal-policy --policy-source-arn <ROLE_ARN> --action-names bedrock:InvokeModel
```

### Issue: Kendra sync fails

**Solution**: Check S3 bucket permissions for Kendra role:
```bash
aws kendra describe-data-source --index-id <ID> --id <DATA_SOURCE_ID>
```

## Contributing

This is a reference implementation. For production use:

1. Enable Kendra Enterprise Edition
2. Add multi-AZ ElastiCache cluster
3. Implement comprehensive error handling
4. Add rate limiting on Bedrock calls
5. Enable AWS Config for compliance
6. Add custom MCP servers for domain-specific analysis
7. Implement findings dashboard
8. Add CI/CD pipeline for agent updates

## License

MIT License - See LICENSE file for details

## Support

For issues and questions:
- Review DESIGN.md for architecture details
- Check CloudWatch Logs for errors
- Verify IAM permissions
- Ensure VPC endpoints are healthy

## Acknowledgments

Built with:
- AWS CDK
- Amazon Bedrock (Claude Sonnet 4)
- Amazon Kendra
- Model Context Protocol (MCP)
- AWS Step Functions
- Amazon ECS Fargate

---

**Version**: 1.0.0  
**Status**: Production Ready  
**Last Updated**: October 20, 2025