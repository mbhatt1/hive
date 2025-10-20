# AutoPurple to Hivemind-Prism Integration Plan

**Version:** 1.0  
**Date:** October 20, 2025  
**Status:** Planning Phase  
**Author:** Technical Planning Team

---

## Executive Summary

This document provides a comprehensive plan for integrating **AutoPurple's** AWS infrastructure security capabilities into **Hivemind-Prism** as MCP servers and agents. The integration extends Hive's security coverage from code analysis to AWS cloud infrastructure, creating a unified security intelligence platform.

### Vision

Combine AutoPurple's AWS-specific security discovery, validation, and remediation capabilities with Hive's serverless architecture, AI-driven intelligence synthesis, and Kendra-based institutional memory to create a comprehensive security platform.

### Key Goals

1. **Preserve AutoPurple's Core Value**: Maintain the ScoutSuite discovery → Pacu validation → AI planning → MCP remediation workflow
2. **Leverage Hive's Strengths**: Use existing serverless infrastructure, agent framework, Bedrock integration, and Kendra memory
3. **MCP-First Architecture**: Implement all new capabilities as MCP servers following Hive's established patterns
4. **Unified Intelligence Archive**: Integrate AWS findings into Hive's existing findings archive and retrieval API

---

## Part 1: AutoPurple Feature Analysis

### 1.1 Core Components

#### ScoutSuite Adapter
**Purpose:** AWS security discovery and compliance scanning

**Key Capabilities:**
- Multi-service AWS scanning (IAM, S3, EC2, Lambda, RDS, KMS, CloudTrail, etc.)
- Compliance framework mapping (CIS, NIST, PCI-DSS)
- Severity-based classification (low, medium, high, critical)
- JSON report generation
- Multi-account and multi-region support

**Integration Value:** Provides comprehensive AWS infrastructure visibility that complements Hive's code security tools

#### Pacu Adapter
**Purpose:** Exploit validation for AWS security findings

**Key Capabilities:**
- Validates if findings are actually exploitable (not just theoretical)
- Maps findings to specific Pacu modules (e.g., iam__enum_permissions, s3__check_bucket_permissions)
- Evidence-based validation with detailed results
- SQLite session tracking for audit trail

**Integration Value:** Reduces false positives by validating exploitability before remediation

#### Claude-Based Planner
**Purpose:** AI-driven analysis and remediation planning

**Key Capabilities:**
- Finding clustering and deduplication
- Risk-based prioritization
- Contextual remediation plan generation
- MCP server call orchestration

**Integration Value:** Can be replaced with Bedrock (Hive's AI engine) while preserving workflow

#### Pipeline Orchestrator
**Purpose:** End-to-end async workflow management

**Key Capabilities:**
- Multi-phase execution (Discovery → Validation → Planning → Remediation → Post-validation)
- Retry logic with exponential backoff
- Comprehensive audit logging
- State persistence in SQLite

**Integration Value:** Can be adapted to Hive's Step Functions orchestration pattern

#### Database Schema
**Purpose:** State and findings persistence

**Tables:**
- `ap_runs`: Execution tracking
- `ap_findings`: Security findings from ScoutSuite
- `ap_validations`: Pacu validation results
- `ap_remediations`: Remediation plans and execution status

**Integration Value:** Provides blueprint for extending Hive's DynamoDB schema

### 1.2 Workflow Comparison

**AutoPurple Workflow:**
```
1. ScoutSuite Discovery → Raw AWS findings
2. Claude Analysis → Clustered, deduped findings
3. Pacu Validation → Exploitable findings only
4. Claude Planning → Remediation plans
5. MCP Execution → Apply fixes
6. Post-validation → Verify fixes
```

**Hive Current Workflow:**
```
1. Code Upload → Source archive
2. Unpack & Scan → MCP tools (Gitleaks, Semgrep, Trivy)
3. Synthesizer Agent → Draft findings
4. Critic Agent → Validate findings with Kendra RAG
5. Archivist Agent → Store in DynamoDB
6. API Retrieval → Query findings
```

**Unified Workflow (Proposed):**
```
1. Input → Code OR AWS Account
2. Discovery → Code MCPs OR ScoutSuite MCP
3. Validation → Static rules OR Pacu MCP
4. Synthesis → Bedrock + Kendra RAG (unified)
5. Archive → DynamoDB (unified schema)
6. API → Unified retrieval (code + AWS findings)
```

---

## Part 2: Hive Architecture Overview

### 2.1 Current Components

**MCP Servers (Fargate-based):**
- [`gitleaks_mcp`](src/mcp_servers/gitleaks_mcp/server.py) - Secret detection
- [`semgrep_mcp`](src/mcp_servers/semgrep_mcp/server.py) - SAST analysis
- [`trivy_mcp`](src/mcp_servers/trivy_mcp/server.py) - Vulnerability scanning

**Agents (Lambda-based):**
- [`Coordinator`](src/agents/coordinator/agent.py) - Workflow orchestration
- [`Critic`](src/agents/critic/agent.py) - Finding validation with RAG
- [`Synthesizer`](src/agents/synthesizer/agent.py) - Intelligence synthesis
- [`Strategist`](src/agents/strategist/agent.py) - Analysis planning
- [`Archaeologist`](src/agents/archaeologist/agent.py) - Context discovery
- [`Archivist`](src/agents/archivist/agent.py) - Knowledge persistence

**Infrastructure:**
- AWS Lambda (agent execution)
- AWS Fargate (MCP server hosting)
- AWS Step Functions (orchestration)
- Amazon S3 (artifact storage)
- Amazon DynamoDB (findings archive)
- Amazon Kendra (RAG memory)
- Amazon Bedrock (AI inference)
- Amazon API Gateway (findings API)

### 2.2 Integration Points

**Where AutoPurple Features Fit:**

1. **MCP Servers Layer**
   - Add [`scoutsuite_mcp`](src/mcp_servers/scoutsuite_mcp/) alongside existing MCP servers
   - Add [`pacu_mcp`](src/mcp_servers/pacu_mcp/) for validation

2. **Agent Layer**
   - Create [`aws_security_orchestrator`](src/agents/aws_security_orchestrator/) agent
   - Extend Coordinator to handle AWS scan missions
   - Extend Synthesizer to process AWS findings

3. **Data Layer**
   - Extend DynamoDB schema for AWS findings
   - Add AWS security docs to Kendra index

4. **API Layer**
   - Add AWS-specific endpoints to findings API

---

## Part 3: Technical Design Specifications

### 3.1 ScoutSuite MCP Server

**Location:** `src/mcp_servers/scoutsuite_mcp/`

**Implementation:**
```python
# server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
import asyncio
import json
from typing import Any, Dict, List

app = Server("scoutsuite-mcp")

@app.list_tools()
async def list_tools() -> List[Dict[str, Any]]:
    return [
        {
            "name": "run_aws_discovery",
            "description": "Run comprehensive AWS security discovery scan using ScoutSuite",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "aws_account_id": {
                        "type": "string",
                        "description": "AWS account ID to scan"
                    },
                    "aws_region": {
                        "type": "string", 
                        "description": "AWS region (e.g., us-east-1)",
                        "default": "us-east-1"
                    },
                    "services": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Specific services to scan (e.g., ['iam', 's3', 'ec2']). Empty = all services"
                    },
                    "report_format": {
                        "type": "string",
                        "enum": ["json", "html"],
                        "default": "json"
                    }
                },
                "required": ["aws_account_id"]
            }
        },
        {
            "name": "parse_findings",
            "description": "Parse ScoutSuite report and extract findings with severity filtering",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "report_path": {
                        "type": "string",
                        "description": "S3 path to ScoutSuite report"
                    },
                    "min_severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                        "default": "medium"
                    },
                    "service_filter": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter findings by service"
                    }
                },
                "required": ["report_path"]
            }
        },
        {
            "name": "get_compliance_posture",
            "description": "Get compliance posture summary for a specific framework",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "report_path": {"type": "string"},
                    "framework": {
                        "type": "string",
                        "enum": ["cis", "pci-dss", "nist", "hipaa"]
                    }
                },
                "required": ["report_path", "framework"]
            }
        }
    ]

@app.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[Dict[str, Any]]:
    if name == "run_aws_discovery":
        return await run_scoutsuite_scan(arguments)
    elif name == "parse_findings":
        return await parse_scoutsuite_report(arguments)
    elif name == "get_compliance_posture":
        return await get_compliance_summary(arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")

async def run_scoutsuite_scan(args: Dict[str, Any]) -> List[Dict[str, Any]]:
    # Implementation here
    pass

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

**Dockerfile:**
```dockerfile
FROM python:3.11-slim

# Install ScoutSuite and dependencies
RUN pip install --no-cache-dir \
    scoutsuite>=5.12.0 \
    boto3>=1.26.0 \
    mcp>=0.9.0

# Copy server code
WORKDIR /app
COPY server.py .
COPY requirements.txt .
RUN pip install -r requirements.txt

# Run MCP server
CMD ["python", "server.py"]
```

**Resource URIs:**
- `aws-finding://{account_id}/{service}/{finding_id}` - Individual finding details
- `aws-report://{account_id}/{scan_timestamp}` - Full scan report
- `aws-compliance://{account_id}/{framework}` - Compliance summary

### 3.2 Pacu MCP Server

**Location:** `src/mcp_servers/pacu_mcp/`

**Implementation:**
```python
# server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
import asyncio
from typing import Any, Dict, List

app = Server("pacu-mcp")

@app.list_tools()
async def list_tools() -> List[Dict[str, Any]]:
    return [
        {
            "name": "validate_finding",
            "description": "Validate if an AWS security finding is exploitable",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "finding_id": {"type": "string"},
                    "service": {"type": "string"},
                    "finding_type": {"type": "string"},
                    "resource_id": {"type": "string"},
                    "session_name": {"type": "string"}
                },
                "required": ["finding_id", "service", "session_name"]
            }
        },
        {
            "name": "run_module",
            "description": "Execute a specific Pacu module",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "module_name": {
                        "type": "string",
                        "description": "Pacu module (e.g., 'iam__enum_permissions')"
                    },
                    "session_name": {"type": "string"},
                    "parameters": {
                        "type": "object",
                        "description": "Module-specific parameters"
                    }
                },
                "required": ["module_name", "session_name"]
            }
        },
        {
            "name": "create_session",
            "description": "Create new Pacu session for validation testing",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_name": {"type": "string"},
                    "aws_profile": {"type": "string"}
                },
                "required": ["session_name"]
            }
        },
        {
            "name": "get_validation_result",
            "description": "Retrieve validation results for a finding",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "finding_id": {"type": "string"},
                    "session_name": {"type": "string"}
                },
                "required": ["finding_id"]
            }
        }
    ]

@app.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[Dict[str, Any]]:
    if name == "validate_finding":
        return await validate_aws_finding(arguments)
    elif name == "run_module":
        return await execute_pacu_module(arguments)
    elif name == "create_session":
        return await create_pacu_session(arguments)
    elif name == "get_validation_result":
        return await get_validation_results(arguments)
    else:
        raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
```

**Resource URIs:**
- `pacu-session://{session_name}` - Session state and metadata
- `pacu-validation://{finding_id}` - Validation results
- `pacu-modules://list` - Available Pacu modules

### 3.3 AWS Security Orchestrator Agent

**Location:** `src/agents/aws_security_orchestrator/`

**Purpose:** Coordinates AWS security analysis workflow

**Key Responsibilities:**
1. Trigger ScoutSuite MCP scans
2. Parse and normalize findings
3. Orchestrate Pacu validation
4. Interface with Synthesizer for intelligence generation
5. Update DynamoDB with results

**Implementation:**
```python
# agent.py
import asyncio
import boto3
import json
from typing import Dict, List, Any
from datetime import datetime

class AWSSecurityOrchestrator:
    """Orchestrates AWS security scanning and validation workflow."""
    
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.findings_table = self.dynamodb.Table('HivemindAWSFindings')
        self.bedrock = boto3.client('bedrock-runtime')
        
    async def execute_scan(
        self,
        mission_id: str,
        aws_account_id: str,
        aws_region: str = 'us-east-1',
        services: List[str] = None
    ) -> Dict[str, Any]:
        """Execute complete AWS security scan workflow."""
        
        scan_result = {
            'mission_id': mission_id,
            'aws_account_id': aws_account_id,
            'aws_region': aws_region,
            'started_at': datetime.utcnow().isoformat(),
            'phases': {}
        }
        
        try:
            # Phase 1: Discovery
            findings = await self.discover_findings(
                aws_account_id, aws_region, services
            )
            scan_result['phases']['discovery'] = {
                'status': 'completed',
                'findings_count': len(findings)
            }
            
            # Phase 2: Validation
            validated = await self.validate_findings(
                findings, mission_id
            )
            scan_result['phases']['validation'] = {
                'status': 'completed',
                'exploitable_count': len(validated)
            }
            
            # Phase 3: Synthesis
            intelligence = await self.synthesize_intelligence(
                validated, mission_id
            )
            scan_result['phases']['synthesis'] = {
                'status': 'completed',
                'intelligence': intelligence
            }
            
            # Phase 4: Archive
            await self.archive_findings(validated, mission_id)
            scan_result['phases']['archive'] = {
                'status': 'completed'
            }
            
            scan_result['status'] = 'completed'
            scan_result['completed_at'] = datetime.utcnow().isoformat()
            
            return scan_result
            
        except Exception as e:
            scan_result['status'] = 'failed'
            scan_result['error'] = str(e)
            raise
    
    async def discover_findings(
        self,
        aws_account_id: str,
        aws_region: str,
        services: List[str]
    ) -> List[Dict[str, Any]]:
        """Run ScoutSuite discovery via MCP."""
        # Call ScoutSuite MCP server
        # Parse results
        # Return normalized findings
        pass
    
    async def validate_findings(
        self,
        findings: List[Dict[str, Any]],
        mission_id: str
    ) -> List[Dict[str, Any]]:
        """Validate findings with Pacu MCP."""
        # Create Pacu session
        # Map findings to modules
        # Execute validation
        # Return exploitable findings only
        pass
    
    async def synthesize_intelligence(
        self,
        findings: List[Dict[str, Any]],
        mission_id: str
    ) -> Dict[str, Any]:
        """Use Bedrock + Kendra to synthesize intelligence."""
        # Query Kendra for context
        # Call Bedrock for analysis
        # Generate recommendations
        pass
    
    async def archive_findings(
        self,
        findings: List[Dict[str, Any]],
        mission_id: str
    ) -> None:
        """Store findings in DynamoDB."""
        # Write to HivemindAWSFindings table
        pass
```

---

## Part 4: Database Schema Extensions

### 4.1 DynamoDB Table: HivemindAWSFindings

**Table Design:**
```json
{
  "TableName": "HivemindAWSFindings",
  "BillingMode": "PAY_PER_REQUEST",
  "KeySchema": [
    {
      "AttributeName": "pk",
      "KeyType": "HASH"
    },
    {
      "AttributeName": "sk",
      "KeyType": "RANGE"
    }
  ],
  "AttributeDefinitions": [
    {"AttributeName": "pk", "AttributeType": "S"},
    {"AttributeName": "sk", "AttributeType": "S"},
    {"AttributeName": "mission_id", "AttributeType": "S"},
    {"AttributeName": "severity", "AttributeType": "S"},
    {"AttributeName": "service", "AttributeType": "S"},
    {"AttributeName": "created_at", "AttributeType": "S"}
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "mission-severity-index",
      "KeySchema": [
        {"AttributeName": "mission_id", "KeyType": "HASH"},
        {"AttributeName": "severity", "KeyType": "RANGE"}
      ],
      "Projection": {"ProjectionType": "ALL"}
    },
    {
      "IndexName": "service-created-index",
      "KeySchema": [
        {"AttributeName": "service", "KeyType": "HASH"},
        {"AttributeName": "created_at", "KeyType": "RANGE"}
      },
      "Projection": {"ProjectionType": "ALL"}
    }
  ],
  "StreamSpecification": {
    "StreamEnabled": true,
    "StreamViewType": "NEW_AND_OLD_IMAGES"
  }
}
```

**Item Structure:**
```json
{
  "pk": "FINDING#<uuid>",
  "sk": "METADATA",
  "mission_id": "<mission_uuid>",
  "finding_id": "<uuid>",
  "source": "scoutsuite",
  "service": "iam",
  "resource_id": "arn:aws:iam::123456789012:policy/example",
  "resource_type": "policy",
  "title": "IAM policy allows overly permissive access",
  "severity": "high",
  "description": "The IAM policy grants more permissions than necessary",
  "evidence": {
    "scoutsuite": {
      "level": "danger",
      "flagged_items": ["s3:*", "ec2:*"],
      "path": "services.iam.policies.arn:aws:iam::123456789012:policy/example"
    }
  },
  "validation": {
    "validated": true,
    "tool": "pacu",
    "module": "iam__enum_permissions",
    "result": "exploitable",
    "executed_at": "2025-10-20T15:00:00Z",
    "evidence": {
      "stdout": "Successfully enumerated permissions...",
      "exploitable": true
    }
  },
  "status": "validated",
  "aws_account": "123456789012",
  "aws_region": "us-east-1",
  "compliance_frameworks": ["cis", "nist"],
  "tags": ["privileged-access", "data-access"],
  "created_at": "2025-10-20T14:00:00Z",
  "updated_at": "2025-10-20T15:00:00Z",
  "ttl": 1735833600
}
```

### 4.2 Access Patterns

1. **Get all findings for a mission:**
   - Query: `mission-severity-index`
   - Key: `mission_id = <uuid>`

2. **Get high-severity findings:**
   - Query: `mission-severity-index`
   - Key: `mission_id = <uuid> AND severity = 'high'`

3. **Get findings by service:**
   - Query: `service-created-index`
   - Key: `service = 'iam'`

4. **Get recent findings:**
   - Query: `service-created-index`
   - Key: `service = 'iam' AND created_at > '2025-10-01'`

---

## Part 5: Step Functions Integration

### 5.1 Extended Workflow

**State Machine Definition (additions):**
```json
{
  "Comment": "Hivemind-Prism Extended with AWS Security",
  "StartAt": "DetermineSource",
  "States": {
    "DetermineSource": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.scan_type",
          "StringEquals": "code",
          "Next": "UnpackAndPrepare"
        },
        {
          "Variable": "$.scan_type",
          "StringEquals": "aws_infrastructure",
          "Next": "InitializeAWSScan"
        }
      ],
      "Default": "UnpackAndPrepare"
    },
    "InitializeAWSScan": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "aws-security-orchestrator",
        "Payload": {
          "action": "initialize",
          "mission_id.$": "$.mission_id",
          "aws_account.$": "$.aws_account",
          "aws_region.$": "$.aws_region"
        }
      },
      "Next": "RunScoutSuiteScan"
    },
    "RunScoutSuiteScan": {
      "Type": "Task",
      "Resource": "arn:aws:states:::fargate:runTask.sync",
      "Parameters": {
        "Cluster": "hivemind-compute",
        "TaskDefinition": "scoutsuite-mcp",
        "LaunchType": "FARGATE",
        "NetworkConfiguration": {
          "AwsvpcConfiguration": {
            "Subnets.$": "$.vpc.private_subnets",
            "SecurityGroups.$": "$.security_groups"
          }
        },
        "Overrides": {
          "ContainerOverrides": [
            {
              "Name": "scoutsuite-mcp",
              "Environment": [
                {"Name": "AWS_ACCOUNT", "Value.$": "$.aws_account"},
                {"Name": "AWS_REGION", "Value.$": "$.aws_region"},
                {"Name": "MISSION_ID", "Value.$": "$.mission_id"}
              ]
            }
          ]
        }
      },
      "Next": "ParseScoutSuiteFindings",
      "Catch": [{
        "ErrorEquals": ["States.ALL"],
        "Next": "FailureHandler"
      }]
    },
    "ParseScoutSuiteFindings": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "aws-security-orchestrator",
        "Payload": {
          "action": "parse_findings",
          "mission_id.$": "$.mission_id",
          "report_path.$": "$.scoutsuite_report_s3_path"
        }
      },
      "ResultPath": "$.findings",
      "Next": "ValidateWithPacu"
    },
    "ValidateWithPacu": {
      "Type": "Task",
      "Resource": "arn:aws:states:::fargate:runTask.sync",
      "Parameters": {
        "Cluster": "hivemind-compute",
        "TaskDefinition": "pacu-mcp",
        "LaunchType": "FARGATE",
        "NetworkConfiguration": {
          "AwsvpcConfiguration": {
            "Subnets.$": "$.vpc.private_subnets",
            "SecurityGroups.$": "$.security_groups"
          }
        },
        "Overrides": {
          "ContainerOverrides": [
            {
              "Name": "pacu-mcp",
              "Environment": [
                {"Name": "FINDINGS", "Value.$": "$.findings"},
                {"Name": "MISSION_ID", "Value.$": "$.mission_id"}
              ]
            }
          ]
        }
      },
      "Next": "SynthesizeAWSIntelligence"
    },
    "SynthesizeAWSIntelligence": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "synthesizer-agent",
        "Payload": {
          "mission_id.$": "$.mission_id",
          "findings_type": "aws_infrastructure",
          "validated_findings.$": "$.validated_findings"
        }
      },
      "Next": "CriticReviewAWS"
    },
    "CriticReviewAWS": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "critic-agent",
        "Payload": {
          "mission_id.$": "$.mission_id",
          "draft_findings.$": "$.synthesized_findings",
          "context_type": "aws_infrastructure"
        }
      },
      "Next": "ArchiveAWSFindings"
    },
    "ArchiveAWSFindings": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "archivist-agent",
        "Payload": {
          "mission_id.$": "$.mission_id",
          "findings.$": "$.final_findings",
          "finding_type": "aws_infrastructure"
        }
      },
      "End": true
    }
  }
}
```

---

## Part 6: Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
**Goal:** Set up core MCP servers

**Tasks:**
- [ ] Create ScoutSuite MCP server directory structure
- [ ] Implement ScoutSuite discovery tools
- [ ] Create Docker container for ScoutSuite MCP
- [ ] Set up CDK stack for Fargate task definition
- [ ] Write unit tests for ScoutSuite MCP
- [ ] Deploy to dev environment
- [ ] Test basic scan functionality

**Deliverables:**
- Working ScoutSuite MCP server
- Container deployed to ECR
- Basic integration tests passing

### Phase 2: Validation Layer (Weeks 3-4)
**Goal:** Add exploit validation capability

**Tasks:**
- [ ] Create Pacu MCP server directory structure
- [ ] Implement Pacu validation tools
- [ ] Create Docker container for Pacu MCP
- [ ] Set up CDK stack for Fargate task definition
- [ ] Implement finding-to-module mapping logic
- [ ] Write unit tests for Pacu MCP
- [ ] Deploy to dev environment
- [ ] Test validation workflow

**Deliverables:**
- Working Pacu MCP server
- Container deployed to ECR
- Validation tests passing

### Phase 3: Orchestration (Weeks 5-6)
**Goal:** Connect MCP servers with agent framework

**Tasks:**
- [ ] Create AWS Security Orchestrator agent
- [ ] Implement discovery workflow
- [ ] Implement validation workflow
- [ ] Integrate with Coordinator agent
- [ ] Update Step Functions state machine
- [ ] Write integration tests
- [ ] Test end-to-end AWS scan pipeline

**Deliverables:**
- Working orchestrator agent
- Extended Step Functions workflow
- End-to-end tests passing

### Phase 4: Data & Intelligence (Weeks 7-8)
**Goal:** Integrate with Hive's data and AI systems

**Tasks:**
- [ ] Create DynamoDB table for AWS findings
- [ ] Extend Synthesizer agent for AWS findings
- [ ] Extend Critic agent for AWS context
- [ ] Add AWS security docs to Kendra
- [ ] Implement RAG-based analysis
- [ ] Write data layer tests
- [ ] Test intelligence synthesis

**Deliverables:**
- AWS findings stored in DynamoDB
- Kendra index updated
- RAG-based analysis working

### Phase 5: API & CLI (Weeks 9-10)
**Goal:** Enable user access to AWS findings

**Tasks:**
- [ ] Extend API Gateway with AWS endpoints
- [ ] Implement findings query handlers
- [ ] Update CLI with AWS scan commands
- [ ] Create API documentation
- [ ] Write API tests
- [ ] Test CLI workflows

**Deliverables:**
- AWS findings API endpoints
- Updated CLI tool
- API documentation

### Phase 6: Testing & Hardening (Weeks 11-12)
**Goal:** Production readiness

**Tasks:**
- [ ] End-to-end integration testing
- [ ] Load testing
- [ ] Security testing
- [ ] Performance optimization
- [ ] Documentation completion
- [ ] User acceptance testing
- [ ] Production deployment

**Deliverables:**
- Production-ready system
- Complete documentation
- Monitoring dashboards

---

## Part 7: Success Metrics

### Functional Metrics
- ✅ ScoutSuite MCP operational with 99%+ uptime
- ✅ Pacu MCP operational with 99%+ uptime
- ✅ End-to-end scan completes in < 30 minutes
- ✅ False positive rate < 5%
- ✅ All findings have validation status
- ✅ API response time < 500ms (p95)

### Business Metrics
- ✅ Cost per scan < $0.50
- ✅ 90%+ code coverage for new components
- ✅ Zero critical security vulnerabilities
- ✅ Complete audit trail for all operations
- ✅ User satisfaction score > 4.5/5

---

## Conclusion

This integration plan provides a comprehensive roadmap for extending Hivemind-Prism with AutoPurple's AWS security capabilities. By following Hive's established architectural patterns and leveraging its existing infrastructure, we create a unified security intelligence platform covering both code and cloud infrastructure.

The phased approach ensures incremental value delivery while maintaining system stability. Upon completion, Hive will offer comprehensive security coverage across the entire application stack.

---

**Next Steps:**
1. Review and approve this integration plan
2. Allocate resources for Phase 1 implementation
3. Set up development environment
4. Begin ScoutSuite MCP server development

**Questions or Feedback:**
Please submit issues or comments via the project issue tracker.