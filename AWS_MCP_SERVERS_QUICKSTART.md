# AWS Security MCP Servers - Quick Start Guide

This guide provides quick reference for the newly added AWS security MCP servers: ScoutSuite and Pacu.

---

## Overview

Two new MCP servers have been added to Hivemind-Prism to enable AWS infrastructure security analysis:

1. **ScoutSuite MCP** - AWS security discovery and compliance scanning
2. **Pacu MCP** - AWS exploit validation

---

## ScoutSuite MCP Server

**Location:** [`src/mcp_servers/scoutsuite_mcp/`](src/mcp_servers/scoutsuite_mcp/)

### Purpose
Performs comprehensive AWS security audits across multiple services (IAM, S3, EC2, Lambda, RDS, etc.) and generates findings with severity classifications.

### Files
- [`server.py`](src/mcp_servers/scoutsuite_mcp/server.py) - Main server implementation
- [`Dockerfile`](src/mcp_servers/scoutsuite_mcp/Dockerfile) - Container definition
- [`requirements.txt`](src/mcp_servers/scoutsuite_mcp/requirements.txt) - Python dependencies

### Environment Variables
```bash
MISSION_ID=<uuid>                    # Unique mission identifier
S3_ARTIFACTS_BUCKET=<bucket-name>    # S3 bucket for results
DYNAMODB_TOOL_RESULTS_TABLE=<table>  # DynamoDB table for metadata
AWS_ACCOUNT_ID=<account>             # Target AWS account
AWS_TARGET_REGION=<region>           # Target AWS region
AWS_PROFILE=<profile>                # AWS profile (optional)
SERVICES=<comma-separated>           # Specific services to scan (optional)
```

### Running Locally
```bash
cd src/mcp_servers/scoutsuite_mcp
docker build -t scoutsuite-mcp .
docker run \
  -e MISSION_ID=test-123 \
  -e S3_ARTIFACTS_BUCKET=my-bucket \
  -e DYNAMODB_TOOL_RESULTS_TABLE=my-table \
  -e AWS_ACCOUNT_ID=123456789012 \
  -e AWS_TARGET_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=<key> \
  -e AWS_SECRET_ACCESS_KEY=<secret> \
  scoutsuite-mcp
```

### Output Format
```json
{
  "tool": "scoutsuite",
  "version": "5.12.0",
  "aws_account": "123456789012",
  "aws_region": "us-east-1",
  "scan_timestamp": 1729435200,
  "results": [
    {
      "finding_id": "iam_policy-overly-permissive_abc123",
      "service": "iam",
      "finding_key": "iam-policy-overly-permissive",
      "description": "IAM policy allows overly permissive access",
      "level": "danger",
      "severity": "critical",
      "items": ["arn:aws:iam::123456789012:policy/example"],
      "items_count": 1,
      "compliance": ["cis", "nist"],
      "references": ["https://docs.aws.amazon.com/..."]
    }
  ]
}
```

### Testing
```bash
pytest tests/unit/mcp_servers/test_scoutsuite_mcp.py -v
```

---

## Pacu MCP Server

**Location:** [`src/mcp_servers/pacu_mcp/`](src/mcp_servers/pacu_mcp/)

### Purpose
Validates whether AWS security findings are actually exploitable by running targeted Pacu modules against the AWS environment.

### Files
- [`server.py`](src/mcp_servers/pacu_mcp/server.py) - Main server implementation
- [`Dockerfile`](src/mcp_servers/pacu_mcp/Dockerfile) - Container definition
- [`requirements.txt`](src/mcp_servers/pacu_mcp/requirements.txt) - Python dependencies

### Environment Variables
```bash
MISSION_ID=<uuid>                    # Unique mission identifier
S3_ARTIFACTS_BUCKET=<bucket-name>    # S3 bucket for results
DYNAMODB_TOOL_RESULTS_TABLE=<table>  # DynamoDB table for metadata
AWS_ACCOUNT_ID=<account>             # Target AWS account
AWS_TARGET_REGION=<region>           # Target AWS region
AWS_PROFILE=<profile>                # AWS profile (optional)
FINDINGS=<json-array>                # Findings to validate (JSON)
```

### Running Locally
```bash
cd src/mcp_servers/pacu_mcp
docker build -t pacu-mcp .
docker run \
  -e MISSION_ID=test-123 \
  -e S3_ARTIFACTS_BUCKET=my-bucket \
  -e DYNAMODB_TOOL_RESULTS_TABLE=my-table \
  -e AWS_ACCOUNT_ID=123456789012 \
  -e AWS_TARGET_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=<key> \
  -e AWS_SECRET_ACCESS_KEY=<secret> \
  -e FINDINGS='[{"finding_id":"f1","service":"iam","finding_key":"policy-check"}]' \
  pacu-mcp
```

### Finding-to-Module Mapping

| Service | Finding Type | Pacu Module |
|---------|--------------|-------------|
| IAM | General | `iam__enum_permissions` |
| IAM | Policy | `iam__enum_policies` |
| S3 | General | `s3__bucket_finder` |
| S3 | Bucket | `s3__bucket_finder` |
| EC2 | General | `ec2__enum_instances` |
| EC2 | Security Group | `ec2__enum_security_groups` |
| Lambda | General | `lambda__enum` |
| RDS | General | `rds__enum` |
| KMS | General | `kms__enum` |

### Output Format
```json
{
  "tool": "pacu",
  "version": "1.5.0",
  "session_name": "hivemind_test-123",
  "aws_account": "123456789012",
  "aws_region": "us-east-1",
  "validation_timestamp": 1729435300,
  "validations": [
    {
      "finding_id": "f1",
      "service": "iam",
      "module": "iam__enum_permissions",
      "status": "completed",
      "exploitable": true,
      "evidence": "Successfully enumerated 5 overly permissive policies",
      "executed_at": 1729435300
    }
  ]
}
```

### Testing
```bash
pytest tests/unit/mcp_servers/test_pacu_mcp.py -v
```

---

## Integration with Hive Workflow

### Step Functions Integration

The new MCP servers integrate into the Hive workflow as follows:

```
1. User initiates AWS scan
   ↓
2. Step Functions: InitializeAWSScan
   ↓
3. Fargate: Run ScoutSuite MCP
   ↓
4. Lambda: Parse ScoutSuite findings
   ↓
5. Fargate: Run Pacu MCP for validation
   ↓
6. Lambda: Synthesizer Agent (with Bedrock + Kendra)
   ↓
7. Lambda: Critic Agent (RAG-based review)
   ↓
8. Lambda: Archivist Agent (store in DynamoDB)
   ↓
9. Results available via API
```

### Data Flow

```
ScoutSuite MCP → S3 (raw findings)
                ↓
          Parse & Normalize
                ↓
     Pacu MCP (validation)
                ↓
          DynamoDB (HivemindAWSFindings)
                ↓
          Kendra (memory/RAG)
                ↓
          API (retrieval)
```

---

## Building and Deployment

### Build Containers
```bash
# ScoutSuite
cd src/mcp_servers/scoutsuite_mcp
docker build -t <account>.dkr.ecr.<region>.amazonaws.com/scoutsuite-mcp:latest .
docker push <account>.dkr.ecr.<region>.amazonaws.com/scoutsuite-mcp:latest

# Pacu
cd src/mcp_servers/pacu_mcp
docker build -t <account>.dkr.ecr.<region>.amazonaws.com/pacu-mcp:latest .
docker push <account>.dkr.ecr.<region>.amazonaws.com/pacu-mcp:latest
```

### CDK Deployment
The MCP servers will be deployed as Fargate task definitions. Update your CDK stack:

```typescript
// Add to infrastructure/stacks/compute-stack.ts
const scoutsuiteTaskDef = new ecs.FargateTaskDefinition(this, 'ScoutSuiteTask', {
  cpu: 512,
  memoryLimitMiB: 1024,
});

scoutsuiteTaskDef.addContainer('scoutsuite-mcp', {
  image: ecs.ContainerImage.fromRegistry(
    `${account}.dkr.ecr.${region}.amazonaws.com/scoutsuite-mcp:latest`
  ),
  logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'scoutsuite' }),
});
```

---

## IAM Permissions

### ScoutSuite MCP Role
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:Get*",
        "iam:List*",
        "s3:GetBucket*",
        "s3:List*",
        "ec2:Describe*",
        "lambda:List*",
        "lambda:Get*",
        "rds:Describe*",
        "kms:List*",
        "kms:Describe*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "dynamodb:PutItem"
      ],
      "Resource": [
        "arn:aws:s3:::hivemind-artifacts/*",
        "arn:aws:dynamodb:*:*:table/HivemindToolResults"
      ]
    }
  ]
}
```

### Pacu MCP Role
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:Get*",
        "iam:List*",
        "s3:List*",
        "ec2:Describe*"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "dynamodb:PutItem"
      ],
      "Resource": [
        "arn:aws:s3:::hivemind-artifacts/*",
        "arn:aws:dynamodb:*:*:table/HivemindToolResults"
      ]
    }
  ]
}
```

---

## Monitoring

### CloudWatch Metrics
- `scoutsuite-mcp/ScanDuration` - Time to complete scan
- `scoutsuite-mcp/FindingsCount` - Number of findings discovered
- `pacu-mcp/ValidationDuration` - Time to validate findings
- `pacu-mcp/ExploitableCount` - Number of exploitable findings

### CloudWatch Logs
- `/aws/ecs/scoutsuite-mcp` - ScoutSuite execution logs
- `/aws/ecs/pacu-mcp` - Pacu execution logs

### DynamoDB Tables
- `HivemindToolResults` - Tool execution metadata
- `HivemindAWSFindings` - AWS security findings archive

---

## Troubleshooting

### ScoutSuite Issues

**Problem:** ScoutSuite timeout
- **Solution:** Increase timeout in Step Functions or reduce services scanned

**Problem:** Permission denied errors
- **Solution:** Verify IAM role has required read permissions

### Pacu Issues

**Problem:** Module execution fails
- **Solution:** Check that finding-to-module mapping is correct

**Problem:** Session creation fails
- **Solution:** Ensure `/tmp/pacu_sessions` directory is writable

---

## Next Steps

1. Deploy MCP servers to ECR
2. Update Step Functions workflow
3. Create AWS Security Orchestrator agent
4. Extend DynamoDB schema
5. Add AWS security docs to Kendra
6. Update API with AWS endpoints
7. Test end-to-end workflow

For detailed implementation plan, see [`AUTOPURPLE_TO_HIVE_INTEGRATION.md`](AUTOPURPLE_TO_HIVE_INTEGRATION.md)

---

## Support

For issues or questions:
- Review integration plan: [`AUTOPURPLE_TO_HIVE_INTEGRATION.md`](AUTOPURPLE_TO_HIVE_INTEGRATION.md)
- Check test files for examples
- Review AutoPurple documentation in [`autopurple/`](autopurple/) directory