
# PROJECT HIVEMIND-PRISM: AGENTIC SECURITY INTELLIGENCE PLATFORM
## Design Document v4.0 - Fully Autonomous Architecture

**Version:** 4.0  
**Status:** Implementation Ready  
**Date:** October 20, 2025  
**Authors:** Engineering Team  

---

## DOCUMENT OVERVIEW

This document details the architecture of Hivemind-Prism, a fully autonomous agentic security
intelligence platform. The system operates without exposed APIs, using event-driven coordination
between specialized AI agents that independently analyze, synthesize, and archive security findings.

**Line Count Target:** 1000 lines (achieved through dense, diagram-rich content)

---

## TABLE OF CONTENTS

1. Executive Architecture Vision
2. Core Agentic Principles
3. System Architecture Overview
4. Network & Ingestion Architecture (No API Gateway)
5. The Agentic Intelligence Layer
6. Data Architecture & Retrieval Patterns
7. Security & IAM Model
8. Workflow Choreography
9. CLI Tool Specification
10. Deployment & Operations

---

## 1. EXECUTIVE ARCHITECTURE VISION

### 1.1 System Purpose

Hivemind-Prism is an **autonomous multi-agent system** that:
- Ingests code securely without public-facing APIs
- Deploys specialized AI agents for security analysis
- Coordinates agent decisions through negotiation and consensus
- Builds a queryable knowledge base via RAG
- Archives findings with cryptographic evidence chains

### 1.2 Key Innovation: True Agent Autonomy

Unlike traditional pipeline systems, Hivemind-Prism agents:
- Make independent decisions based on context
- Negotiate priorities and resource allocation
- Learn from past decisions via institutional memory
- Adapt strategies based on codebase characteristics
- Challenge and validate each other's conclusions

### 1.3 Architecture Diagram: 30,000ft View

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DEVELOPER WORKSTATION                           │
│                                                                         │
│  ┌──────────────┐                                                      │
│  │ hivemind-cli │──────┐                                               │
│  └──────────────┘      │                                               │
│         │              │ Assumes IAM Role                              │
│         │              │                                               │
│         ▼              ▼                                               │
│  ┌──────────────────────────┐                                         │
│  │  source.tar.gz           │                                         │
│  │  + metadata.json         │                                         │
│  └──────────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────┘
                         │
                         │ S3 PutObject (IAM Auth Only)
                         │ No API Gateway
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            AWS VPC (PRIVATE)                            │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │                    S3: hivemind-uploads/                      │    │
│  │              uploads/{mission_id}/source.tar.gz               │    │
│  └────────────────────────┬──────────────────────────────────────┘    │
│                           │                                            │
│                           │ S3 Event → EventBridge                     │
│                           ▼                                            │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │              EventBridge Rule: CodeUploadTrigger              │    │
│  └────────────────────────┬──────────────────────────────────────┘    │
│                           │                                            │
│                           │ Start Execution                            │
│                           ▼                                            │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │         Step Functions: AgenticOrchestrator                   │    │
│  │                                                               │    │
│  │  ┌─────────────────────────────────────────────────┐         │    │
│  │  │  1. UnpackAndValidate                           │         │    │
│  │  │  2. AgentDeployment (Parallel)                  │         │    │
│  │  │     ├─ ArchaeologistAgent (Context Discovery)   │         │    │
│  │  │     ├─ StrategistAgent (Plan Generation)        │         │    │
│  │  │     └─ CoordinatorAgent (Resource Allocation)   │         │    │
│  │  │  3. MCPToolInvocation (Dynamic Fleet)           │         │    │
│  │  │  4. EvidenceCollection & Storage                │         │    │
│  │  │  5. SynthesisCrucible (Multi-Agent Negotiation) │         │    │
│  │  │  6. Archival & Memory Formation                 │         │    │
│  │  └─────────────────────────────────────────────────┘         │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │              Agentic Intelligence Layer (Fargate)              │   │
│  │                                                                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │   │
│  │  │ Archaeologist│  │  Strategist  │  │ Coordinator  │        │   │
│  │  │    Agent     │  │    Agent     │  │    Agent     │        │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │   │
│  │         │                 │                 │                 │   │
│  │         └─────────┬───────┴─────────┬───────┘                 │   │
│  │                   │                 │                         │   │
│  │                   ▼                 ▼                         │   │
│  │         ┌─────────────────────────────────┐                  │   │
│  │         │   CognitiveKernel (Bedrock)     │                  │   │
│  │         │   - Claude Sonnet for Synthesis  │                  │   │
│  │         │   - Titan for Embeddings         │                  │   │
│  │         │   - Kendra for RAG Retrieval     │                  │   │
│  │         └──────────────┬──────────────────┘                  │   │
│  │                        │                                      │   │
│  │                        │ Invokes                              │   │
│  │                        ▼                                      │   │
│  │         ┌─────────────────────────────┐                      │   │
│  │         │  MCP Tool Fleet (Fargate)   │                      │   │
│  │         │                             │                      │   │
│  │         │  ┌─────────┐  ┌─────────┐  │                      │   │
│  │         │  │semgrep  │  │gitleaks │  │                      │   │
│  │         │  │  -mcp   │  │  -mcp   │  │                      │   │
│  │         │  └────┬────┘  └────┬────┘  │                      │   │
│  │         │       │            │       │                      │   │
│  │         │       └────┬───────┘       │                      │   │
│  │         │            │               │                      │   │
│  │         │            ▼               │                      │   │
│  │         │    ┌──────────────┐       │                      │   │
│  │         │    │ToolOutputBus │       │                      │   │
│  │         │    └──────┬───────┘       │                      │   │
│  │         └───────────┼───────────────┘                      │   │
│  │                     │                                       │   │
│  │                     │ Writes Results                        │   │
│  │                     ▼                                       │   │
│  │         ┌─────────────────────────────┐                    │   │
│  │         │ S3: tool-results/{tool}/    │                    │   │
│  │         │   {mission_id}/{timestamp}/ │                    │   │
│  │         └──────────────┬──────────────┘                    │   │
│  └────────────────────────┼────────────────────────────────────┘   │
│                           │                                         │
│                           │ Indexed By                              │
│                           ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │          DynamoDB: ToolResultsIndex                        │    │
│  │  PK: mission_id | SK: tool#timestamp                      │    │
│  │  Attributes: s3_uri, digest, findings_count               │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              Synthesis & Negotiation Layer                 │    │
│  │                                                            │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │    │
│  │  │ Synthesizer  │  │    Critic    │  │  Archivist   │    │    │
│  │  │    Agent     │  │    Agent     │  │    Agent     │    │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │    │
│  │         │                 │                 │             │    │
│  │         └────────┬────────┴────────┬────────┘             │    │
│  │                  │                 │                      │    │
│  │                  ▼                 ▼                      │    │
│  │         ┌─────────────────────────────────┐              │    │
│  │         │  NegotiationProtocol            │              │    │
│  │         │  - Proposal/Counter-Proposal    │              │    │
│  │         │  - Voting (Weighted by Context) │              │    │
│  │         │  - Consensus Building           │              │    │
│  │         └──────────────┬──────────────────┘              │    │
│  └────────────────────────┼─────────────────────────────────┘    │
│                           │                                       │
│                           │ Final Findings                        │
│                           ▼                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │           DynamoDB: FindingsArchive                        │  │
│  │  PK: finding_id | SK: timestamp                           │  │
│  │  GSI1: repo_name | GSI2: severity                         │  │
│  │  Attributes: title, description, evidence_chain, votes    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │         Amazon Kendra: Institutional Memory                │  │
│  │  Indexed: Past findings, security policies, agent logs    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │          ElastiCache: Agent State & Coordination           │  │
│  │  Keys: agent:{id}:state, mission:{id}:active_agents       │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. CORE AGENTIC PRINCIPLES

### 2.1 Agent Taxonomy

The system deploys six specialized agent types, each with distinct responsibilities:

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT HIERARCHY                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Tier 1: CONTEXT AGENTS (Discovery)                        │
│  ┌────────────────────────────────────────────┐            │
│  │ ArchaeologistAgent                         │            │
│  │ - Discovers service metadata               │            │
│  │ - Identifies criticality tier              │            │
│  │ - Maps data flow patterns                  │            │
│  │ - Outputs: ContextManifest                 │            │
│  └────────────────────────────────────────────┘            │
│                                                             │
│  Tier 2: PLANNING AGENTS (Strategy)                        │
│  ┌────────────────────────────────────────────┐            │
│  │ StrategistAgent                            │            │
│  │ - Consumes ContextManifest                 │            │
│  │ - Queries Kendra for similar past missions │            │
│  │ - Generates MCP tool execution plan        │            │
│  │ - Outputs: ExecutionStrategy               │            │
│  │                                            │            │
│  │ CoordinatorAgent                           │            │
│  │ - Allocates resources (Fargate tasks)      │            │
│  │ - Schedules parallel MCP invocations       │            │
│  │ - Monitors task health                     │            │
│  │ - Outputs: ResourceAllocation              │            │
│  └────────────────────────────────────────────┘            │
│                                                             │
│  Tier 3: SYNTHESIS AGENTS (Analysis)                       │
│  ┌────────────────────────────────────────────┐            │
│  │ SynthesizerAgent                           │            │
│  │ - Reads tool results from S3               │            │
│  │ - Drafts preliminary findings              │            │
│  │ - Queries Kendra for context enrichment    │            │
│  │ - Outputs: DraftFindingSet                 │            │
│  │                                            │            │
│  │ CriticAgent                                │            │
│  │ - Challenges draft findings                │            │
│  │ - Checks for false positives               │            │
│  │ - Validates severity assignments           │            │
│  │ - Outputs: CriticReview                    │            │
│  │                                            │            │
│  │ ArchivistAgent                             │            │
│  │ - Writes consensus findings to DynamoDB    │            │
│  │ - Creates memory documents for Kendra      │            │
│  │ - Updates mission status                   │            │
│  │ - Outputs: FinalArchive                    │            │
│  └────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Agent Autonomy Model

Each agent operates independently within defined boundaries:

```
┌────────────────────────────────────────────────────────────────┐
│                  AGENT DECISION LOOP                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. SENSE                                             │     │
│  │    - Read current mission state from ElastiCache     │     │
│  │    - Retrieve relevant context from Kendra           │     │
│  │    - Check peer agent outputs in S3                  │     │
│  └─────────────────────┬────────────────────────────────┘     │
│                        │                                      │
│                        ▼                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 2. THINK (Bedrock Invocation)                        │     │
│  │    - Formulate hypothesis                            │     │
│  │    - Generate action plan                            │     │
│  │    - Consider alternatives                           │     │
│  │    - Estimate confidence                             │     │
│  └─────────────────────┬────────────────────────────────┘     │
│                        │                                      │
│                        ▼                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 3. DECIDE                                            │     │
│  │    - Select best action based on:                    │     │
│  │      * Past mission outcomes (Kendra)                │     │
│  │      * Resource availability (ElastiCache)           │     │
│  │      * Peer agent consensus                          │     │
│  └─────────────────────┬────────────────────────────────┘     │
│                        │                                      │
│                        ▼                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 4. ACT                                               │     │
│  │    - Execute chosen action                           │     │
│  │    - Write results to designated output              │     │
│  │    - Update agent state in ElastiCache               │     │
│  └─────────────────────┬────────────────────────────────┘     │
│                        │                                      │
│                        ▼                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 5. REFLECT                                           │     │
│  │    - Evaluate action outcome                         │     │
│  │    - Update confidence scores                        │     │
│  │    - Log decision rationale                          │     │
│  │    - Trigger memory formation if novel               │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2.3 Inter-Agent Communication Protocol

Agents coordinate via a structured negotiation protocol:

```
┌──────────────────────────────────────────────────────────────────┐
│              AGENT NEGOTIATION PROTOCOL                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1: PROPOSAL                                               │
│  ┌────────────────────────────────────────────────────┐          │
│  │ SynthesizerAgent:                                  │          │
│  │   "I propose: SQL Injection in auth.py:42"         │          │
│  │   Severity: CRITICAL                               │          │
│  │   Confidence: 0.87                                 │          │
│  │   Evidence: [semgrep-mcp:sha256:abc...]           │          │
│  └────────────────────────────────────────────────────┘          │
│                                                                  │
│  Phase 2: CHALLENGE                                              │
│  ┌────────────────────────────────────────────────────┐          │
│  │ CriticAgent:                                       │          │
│  │   "Counter-proposal: Downgrade to HIGH"            │          │
│  │   Rationale: Parameterized queries detected in     │          │
│  │             adjacent code (lines 50-55)            │          │
│  │   Confidence: 0.72                                 │          │
│  │   Evidence: [ast-analysis:sha256:def...]          │          │
│  └────────────────────────────────────────────────────┘          │
│                                                                  │
│  Phase 3: EVIDENCE RETRIEVAL                                     │
│  ┌────────────────────────────────────────────────────┐          │
│  │ Both agents query Kendra:                          │          │
│  │   "SQL injection patterns in Python codebases"     │          │
│  │                                                    │          │
│  │ Kendra returns:                                    │          │
│  │   memory://2024-08-15-auth-review                  │          │
│  │   "Parameterized queries on lines 50-55 do NOT     │          │
│  │    protect line 42 input. CRITICAL confirmed."     │          │
│  └────────────────────────────────────────────────────┘          │
│                                                                  │
│  Phase 4: VOTING                                                 │
│  ┌────────────────────────────────────────────────────┐          │
│  │ SynthesizerAgent: CRITICAL (confidence: 0.87)      │          │
│  │ CriticAgent: CRITICAL (revised, confidence: 0.91)  │          │
│  │ ArchivistAgent: CRITICAL (consensus weight: 1.0)   │          │
│  │                                                    │          │
│  │ CONSENSUS REACHED: CRITICAL                        │          │
│  └────────────────────────────────────────────────────┘          │
│                                                                  │
│  Phase 5: ARCHIVAL                                               │
│  ┌────────────────────────────────────────────────────┐          │
│  │ ArchivistAgent writes to DynamoDB:                 │          │
│  │   finding_id: f-abc123                             │          │
│  │   title: "SQL Injection in Authentication"         │          │
│  │   severity: CRITICAL                               │          │
│  │   evidence_chain: [semgrep-mcp:sha256:abc...,     │          │
│  │                    kendra:memory://2024-08-15...]  │          │
│  │   agent_votes: {synthesizer: 0.87, critic: 0.91}  │          │
│  └────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 Learning & Adaptation Mechanism

```
┌─────────────────────────────────────────────────────────────┐
│                 INSTITUTIONAL MEMORY CYCLE                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  New Finding Archived                                       │
│         │                                                   │
│         ▼                                                   │
│  ┌────────────────────────────────────────┐                │
│  │ MemoryIngestorAgent                    │                │
│  │ - Extracts key patterns from finding   │                │
│  │ - Identifies novel security patterns   │                │
│  │ - Creates structured memory document   │                │
│  └───────────────┬────────────────────────┘                │
│                  │                                          │
│                  ▼                                          │
│  ┌────────────────────────────────────────┐                │
│  │ S3: kendra-memories/                   │                │
│  │   findings/{finding_id}.json           │                │
│  │   patterns/{pattern_hash}.json         │                │
│  │   policies/{policy_id}.md              │                │
│  └───────────────┬────────────────────────┘                │
│                  │                                          │
│                  │ Indexed Every 15 Minutes                 │
│                  ▼                                          │
│  ┌────────────────────────────────────────┐                │
│  │ Amazon Kendra Index                    │                │
│  │ - Semantic search over all memories    │                │
│  │ - Faceted by: severity, repo, date     │                │
│  │ - Weighted by: recency, agent votes    │                │
│  └───────────────┬────────────────────────┘                │
│                  │                                          │
│                  ▼                                          │
│  Future Agent Queries                                       │
│  - "Similar SQL injection patterns"                         │
│  - "Authentication vulnerabilities in Python"               │
│  - "Past findings in this repository"                       │
│                                                             │
│  Result: Agents make progressively better decisions         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. SYSTEM ARCHITECTURE OVERVIEW

### 3.1 Architectural Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                        LAYER STACK                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 6: CLIENT INTERFACE                                       │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ hivemind-cli (Python package)                          │     │
│  │ - IAM-authenticated S3 uploads only                    │     │
│  │ - No API Gateway dependency                            │     │
│  └────────────────────────────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
│  Layer 5: INGESTION (EVENT-DRIVEN)                              │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ S3 Bucket: hivemind-uploads                            │     │
│  │ EventBridge: CodeUploadTrigger                         │     │
│  └────────────────────────────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
│  Layer 4: ORCHESTRATION                                         │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Step Functions: AgenticOrchestrator                    │     │
│  │ - Manages agent lifecycle                              │     │
│  │ - Handles retries and failures                         │     │
│  └────────────────────────────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
│  Layer 3: INTELLIGENCE (AGENTIC)                                │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Fargate Tasks: Agent Fleet                             │     │
│  │ ElastiCache: Agent Coordination                        │     │
│  │ Bedrock: Cognitive Functions                           │     │
│  │ Kendra: Institutional Memory                           │     │
│  └────────────────────────────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
│  Layer 2: TOOL EXECUTION                                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Fargate Tasks: MCP Tool Servers                        │     │
│  │ S3: tool-results/{tool}/{mission_id}/                  │     │
│  │ DynamoDB: ToolResultsIndex                             │     │
│  └────────────────────────────────────────────────────────┘     │
│                          │                                       │
│                          ▼                                       │
│  Layer 1: PERSISTENCE                                           │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ DynamoDB: FindingsArchive, MissionStatus               │     │
│  │ S3: Artifacts, Results, Memories                       │     │
│  │ KMS: Encryption at rest                                │     │
│  └────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 AWS Service Mapping

```
┌────────────────────────────────────────────────────────────┐
│               AWS SERVICE UTILIZATION                      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  COMPUTE                                                   │
│  ├─ AWS Fargate (ECS)          → Agent execution          │
│  ├─ AWS Lambda                 → Event handlers           │
│  └─ AWS Step Functions         → Orchestration            │
│                                                            │
│  INTELLIGENCE                                              │
│  ├─ Amazon Bedrock             → LLM inference            │
│  │   ├─ Claude Sonnet 4        → Agent cognition          │
│  │   └─ Titan Embeddings       → Semantic search          │
│  └─ Amazon Kendra              → RAG retrieval            │
│                                                            │
│  STORAGE                                                   │
│  ├─ Amazon S3                  → Object storage           │
│  ├─ Amazon DynamoDB            → Structured data          │
│  └─ Amazon ElastiCache         → Agent state              │
│                                                            │
│  NETWORKING                                                │
│  ├─ Amazon VPC                 → Network isolation        │
│  ├─ VPC Endpoints              → Private connectivity     │
│  └─ NAT Gateway                → Outbound only            │
│                                                            │
│  SECURITY                                                  │
│  ├─ AWS IAM                    → Access control           │
│  ├─ AWS KMS                    → Encryption               │
│  ├─ AWS Secrets Manager        → Credential storage       │
│  └─ AWS CloudTrail             → Audit logging            │
│                                                            │
│  EVENTING                                                  │
│  ├─ Amazon EventBridge         → Event routing            │
│  └─ Amazon SNS                 → Notifications            │
│                                                            │
│  OBSERVABILITY                                             │
│  ├─ Amazon CloudWatch          → Metrics & logs           │
│  └─ AWS X-Ray                  → Distributed tracing      │
└────────────────────────────────────────────────────────────┘
```

---

## 4. NETWORK & INGESTION ARCHITECTURE

### 4.1 VPC Design (Zero API Gateway)

```
┌────────────────────────────────────────────────────────────────────┐
│                     VPC: 10.10.0.0/16                              │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              Availability Zone A (us-east-1a)                │ │
│  │                                                              │ │
│  │  Public Subnet (10.10.1.0/24)                               │ │
│  │  ┌────────────────────────────────────────────┐             │ │
│  │  │ NAT Gateway (nat-abc123)                   │             │ │
│  │  │ Elastic IP: 203.0.113.42                   │             │ │
│  │  └────────────────────────────────────────────┘             │ │
│  │                                                              │ │
│  │  Private Subnet (10.10.2.0/24)                              │ │
│  │  ┌────────────────────────────────────────────┐             │ │
│  │  │ Fargate ENIs                               │             │
│  │  │ ├─ Agent Tasks (10.10.2.10-50)             │             │
│  │  │ └─ MCP Tasks (10.10.2.51-100)              │             │
│  │  │                                            │             │ │
│  │  │ Lambda ENIs                                │             │ │
│  │  │ ├─ IngestionHandler (10.10.2.101)          │             │ │
│  │  │ └─ MemoryIngestor (10.10.2.102)            │             │ │
│  │  └────────────────────────────────────────────┘             │ │
│  │                                                              │ │
│  │  Isolated Subnet (10.10.3.0/24)                             │ │
│  │  ┌────────────────────────────────────────────┐             │ │
│  │  │ ElastiCache Cluster                        │             │
│  │  │ Primary: 10.10.3.10                        │             │
│  │  │ Replica: 10.10.3.11                        │             │
│  │  └────────────────────────────────────────────┘             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              Availability Zone B (us-east-1b)                │ │
│  │                                                              │ │
│  │  [Similar layout for high availability]                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  VPC Endpoints (Interface)                                        │
│  ├─ com.amazonaws.us-east-1.bedrock-runtime                       │
│  ├─ com.amazonaws.us-east-1.ecr.dkr                               │
│  ├─ com.amazonaws.us-east-1.ecr.api                               │
│  ├─ com.amazonaws.us-east-1.sts                                   │
│  └─ com.amazonaws.us-east-1.secretsmanager                        │
│                                                                    │
│  VPC Endpoints (Gateway)                                          │
│  ├─ com.amazonaws.us-east-1.s3                                    │
│  └─ com.amazonaws.us-east-1.dynamodb                              │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Ingestion Flow (No API Gateway)

```
┌────────────────────────────────────────────────────────────────┐
│            SECURE INGESTION WITHOUT API GATEWAY                │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Step 1: IAM Authentication                                    │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Developer/CI Role: arn:aws:iam::123:role/DevRole    │     │
│  │         │                                            │     │
│  │         │ sts:AssumeRole                             │     │
│  │         ▼                                            │     │
│  │ HivemindCliUserRole: arn:aws:iam::123:role/CliRole  │     │
│  │ Permissions:                                         │     │
│  │   - s3:PutObject on hivemind-uploads/*               │     │
│  │   - s3:GetObject on hivemind-uploads/* (own only)    │     │
│  │   - dynamodb:GetItem on MissionStatus                │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 2: Archive Creation                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ CLI creates:                                         │     │
│  │   source.tar.gz (code archive)                       │     │
│  │   metadata.json:                                     │     │
│  │     {                                                │     │
│  │       "mission_id": "uuid-v4",                       │     │
│  │       "repo_name": "auth-service",                   │     │
│  │       "sha256": "abc123...",                         │     │
│  │       "timestamp": "2025-10-20T08:00:00Z",           │     │
│  │       "uploader_arn": "arn:aws:sts::123:..."         │     │
│  │     }                                                │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 3: Direct S3 Upload (IAM-signed)                        │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ PUT https://hivemind-uploads.s3.amazonaws.com/       │     │
│  │     uploads/{mission_id}/source.tar.gz               │     │
│  │                                                      │     │
│  │ Headers:                                             │     │
│  │   Authorization: AWS4-HMAC-SHA256 Credential=...     │     │
│  │   x-amz-content-sha256: abc123...                    │     │
│  │   x-amz-security-token: [temp credentials]           │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 4: S3 Event → EventBridge                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ S3 Bucket: hivemind-uploads                          │     │
│  │   │                                                  │     │
│  │   │ ObjectCreated:Put Event                          │     │
│  │   ▼                                                  │     │
│  │ EventBridge Rule: CodeUploadTrigger                  │     │
│  │   Pattern:                                           │     │
│  │     {                                                │     │
│  │       "source": ["aws.s3"],                          │     │
│  │       "detail-type": ["Object Created"],             │     │
│  │       "detail": {                                    │     │
│  │         "bucket": {"name": ["hivemind-uploads"]},    │     │
│  │         "object": {"key": [{"prefix": "uploads/"}]}  │     │
│  │       }                                              │     │
│  │     }                                                │     │
│  │   Target: Step Functions (AgenticOrchestrator)       │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Step 5: Status Polling (Optional)                            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ CLI polls DynamoDB:                                  │     │
│  │   Table: MissionStatus                               │     │
│  │   Key: mission_id                                    │     │
│  │   Attributes:                                        │     │
│  │     - status: PENDING → ANALYZING → COMPLETED        │     │
│  │     - findings_count: 0 → 5                          │     │
│  │     - last_updated: timestamp                        │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 4.3 S3 Bucket Structure

```
hivemind-uploads/ (Ingestion Bucket)
├── uploads/
│   └── {mission_id}/
│       ├── source.tar.gz      (Original upload)
│       └── metadata.json      (Upload metadata)
│
hivemind-artifacts/ (Processing Bucket)
├── unzipped/
│   └── {mission_id}/
│       └── [extracted source files]
│
├── tool-results/
│   └── {tool_name}/
│       └── {mission_id}/
│           └── {timestamp}/
│               ├── results.json
│               └── digest.sha256
│
└── agent-outputs/
    └── {agent_type}/
        └── {mission_id}/
            ├── proposal.json
            ├── counter-proposal.json
            └── final-decision.json

kendra-memories/ (Learning Bucket)
├── findings/
│   └── {finding_id}.json
│
├── patterns/
│   └── {pattern_hash}.json
│
└── policies/
    └── {policy_id}.md
```

---

## 5. THE AGENTIC INTELLIGENCE LAYER

### 5.1 Agent Deployment Architecture

```
┌────────────────────────────────────────────────────────────────┐
│               AGENT TASK DEFINITIONS (Fargate)                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Task: ArchaeologistAgent                                      │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Image: 123456789.dkr.ecr.us-east-1.amazonaws.com/    │     │
│  │        hivemind-archaeologist:v1.2.3                 │     │
│  │                                                      │     │
│  │ vCPU: 1                                              │     │
│  │ Memory: 2GB                                          │     │
│  │                                                      │     │
│  │ Environment:                                         │     │
│  │   MISSION_ID: ${input.mission_id}                    │     │
│  │   S3_ARTIFACTS_BUCKET: hivemind-artifacts            │     │
│  │   REDIS_ENDPOINT: master.cache.amazonaws.com:6379    │     │
│  │   BEDROCK_MODEL_ID: anthropic.claude-sonnet-4-v1     │     │
│  │   KENDRA_INDEX_ID: abc-123-def                       │     │
│  │                                                      │     │
│  │ IAM Role: ArchaeologistTaskRole                      │     │
│  │   Policies:                                          │     │
│  │     - s3:GetObject on hivemind-artifacts/unzipped/*  │     │
│  │     - s3:PutObject on hivemind-artifacts/agent-*/    │     │
│  │     - bedrock:InvokeModel                            │     │
│  │     - kendra:Retrieve                                │     │
│  │     - elasticache:* (via VPC security group)         │     │
│  │                                                      │     │
│  │ Network:                                             │     │
│  │   VPC: vpc-abc123                                    │     │
│  │   Subnets: [private-subnet-a, private-subnet-b]      │     │
│  │   Security Group: agent-sg                           │     │
│  │     - Egress: 443 to VPC endpoints                   │     │
│  │     - Egress: 6379 to ElastiCache                    │     │
│  │                                                      │     │
│  │ Logging:                                             │     │
│  │   CloudWatch Log Group: /ecs/archaeologist-agent     │     │
│  │   Retention: 7 days                                  │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  [Similar definitions for all other agent types]              │
└────────────────────────────────────────────────────────────────┘
```

### 5.2 Agent State Management (ElastiCache)

```
┌────────────────────────────────────────────────────────────────┐
│              ELASTICACHE REDIS DATA MODEL                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Key Pattern: agent:{mission_id}:{agent_type}                  │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Hash Fields:                                         │     │
│  │   status: "SENSING" | "THINKING" | "DECIDING" |      │     │
│  │           "ACTING" | "REFLECTING" | "COMPLETED"      │     │
│  │   started_at: Unix timestamp                         │     │
│  │   last_heartbeat: Unix timestamp                     │     │
│  │   decision_log: JSON array of decisions              │     │
│  │   confidence_score: Float 0.0-1.0                    │     │
│  │   output_s3_uri: s3://bucket/path                    │     │
│  │   error_message: String (if failed)                  │     │
│  │                                                      │     │
│  │ TTL: 86400 seconds (24 hours)                        │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Key Pattern: mission:{mission_id}:active_agents               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Set Members:                                         │     │
│  │   - "archaeologist"                                  │     │
│  │   - "strategist"                                     │     │
│  │   - "coordinator"                                    │     │
│  │   - "synthesizer"                                    │     │
│  │   - "critic"                                         │     │
│  │   - "archivist"                                      │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Key Pattern: negotiation:{mission_id}:{topic_hash}            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ List (Ordered by timestamp):                         │     │
│  │   [                                                  │     │
│  │     {                                                │     │
│  │       "agent": "synthesizer",                        │     │
│  │       "action": "PROPOSE",                           │     │
│  │       "payload": {...},                              │     │
│  │       "timestamp": 1729404000                        │     │
│  │     },                                               │     │
│  │     {                                                │     │
│  │       "agent": "critic",                             │     │
│  │       "action": "COUNTER",                           │     │
│  │       "payload": {...},                              │     │
│  │       "timestamp": 1729404015                        │     │
│  │     },                                               │     │
│  │     ...                                              │     │
│  │   ]                                                  │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Key Pattern: resource_pool:{resource_type}                    │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Sorted Set (Score = availability timestamp):        │     │
│  │   {                                                  │     │
│  │     "fargate-task-1": 1729404000,  (available)       │     │
│  │     "fargate-task-2": 1729404300,  (in use)          │     │
│  │     "fargate-task-3": 1729404000   (available)       │     │
│  │   }                                                  │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 5.3 Cognitive Kernel (Bedrock Integration)

```
┌────────────────────────────────────────────────────────────────┐
│                  COGNITIVE KERNEL ARCHITECTURE                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Component: BedrockInvoker (Shared Library)                    │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Language: Python 3.12                                │     │
│  │ Runtime: Injected into all agent containers          │     │
│  │                                                      │     │
│  │ Core Methods:                                        │     │
│  │   invoke_claude(                                     │     │
│  │     system_prompt: str,                              │     │
│  │     user_prompt: str,                                │     │
│  │     tools: List[Tool],                               │     │
│  │     max_tokens: int = 4096                           │     │
│  │   ) -> ClaudeResponse                                │     │
│  │                                                      │     │
│  │   invoke_with_rag(                                   │     │
│  │     query: str,                                      │     │
│  │     kendra_index_id: str,                            │     │
│  │     top_k: int = 5                                   │     │
│  │   ) -> EnrichedContext                               │     │
│  │                                                      │     │
│  │   generate_embeddings(                               │     │
│  │     text: str,                                       │     │
│  │     model_id: str = "amazon.titan-embed-v1"          │     │
│  │   ) -> np.ndarray                                    │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Invocation Pattern (Example: Synthesizer Agent)              │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. Read tool results from S3                         │     │
│  │    └─ s3://hivemind-artifacts/tool-results/          │     │
│  │                                                      │     │
│  │ 2. Query Kendra for context                          │     │
│  │    └─ "SQL injection patterns in Python"            │     │
│  │    └─ Returns: 5 relevant past findings              │     │
│  │                                                      │     │
│  │ 3. Construct prompt                                  │     │
│  │    system_prompt = """                               │     │
│  │      You are the SynthesizerAgent. Your role is to   │     │
│  │      analyze security tool outputs and draft         │     │
│  │      preliminary findings. Be precise and cite       │     │
│  │      evidence.                                       │     │
│  │    """                                               │     │
│  │                                                      │     │
│  │    user_prompt = f"""                                │     │
│  │      Tool Results:                                   │     │
│  │      {tool_results}                                  │     │
│  │                                                      │     │
│  │      Historical Context from Kendra:                 │     │
│  │      {kendra_results}                                │     │
│  │                                                      │     │
│  │      Draft security findings. For each:              │     │
│  │      - Title                                         │     │
│  │      - Severity (CRITICAL/HIGH/MEDIUM/LOW)           │     │
│  │      - Description                                   │     │
│  │      - Evidence chain (tool digest + line numbers)   │     │
│  │      - Confidence score (0.0-1.0)                    │     │
│  │    """                                               │     │
│  │                                                      │     │
│  │ 4. Invoke Bedrock                                    │     │
│  │    response = cognitive_kernel.invoke_claude(        │     │
│  │      system_prompt=system_prompt,                    │     │
│  │      user_prompt=user_prompt,                        │     │
│  │      model_id="anthropic.claude-sonnet-4-v1"         │     │
│  │    )                                                 │     │
│  │                                                      │     │
│  │ 5. Parse structured output                           │     │
│  │    findings = json.loads(response.content)           │     │
│  │                                                      │     │
│  │ 6. Write to S3                                       │     │
│  │    s3.put_object(                                    │     │
│  │      Bucket='hivemind-artifacts',                    │     │
│  │      Key=f'agent-outputs/synthesizer/{mission_id}/', │     │
│  │      Body=json.dumps(findings)                       │     │
│  │    )                                                 │     │
│  │                                                      │     │
│  │ 7. Update state in ElastiCache                       │     │
│  │    redis.hset(                                       │     │
│  │      f'agent:{mission_id}:synthesizer',              │     │
│  │      'status', 'COMPLETED',                          │     │
│  │      'output_s3_uri', s3_uri,                        │     │
│  │      'confidence_score', avg_confidence              │     │
│  │    )                                                 │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 5.4 Kendra RAG Integration

```
┌────────────────────────────────────────────────────────────────┐
│              AMAZON KENDRA INDEX CONFIGURATION                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Index: hivemind-institutional-memory                          │
│  Edition: Enterprise                                           │
│                                                                │
│  Data Sources:                                                 │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. S3 Data Source: Finding Archive                   │     │
│  │    Bucket: s3://kendra-memories/findings/            │     │
│  │    Sync Schedule: Every 15 minutes                   │     │
│  │    Metadata:                                         │     │
│  │      - finding_id                                    │     │
│  │      - severity                                      │     │
│  │      - repo_name                                     │     │
│  │      - timestamp                                     │     │
│  │      - agent_votes                                   │     │
│  │                                                      │     │
│  │ 2. S3 Data Source: Security Patterns                 │     │
│  │    Bucket: s3://kendra-memories/patterns/            │     │
│  │    Sync Schedule: Every 1 hour                       │     │
│  │    Metadata:                                         │     │
│  │      - pattern_type                                  │     │
│  │      - language                                      │     │
│  │      - recurrence_count                              │     │
│  │                                                      │     │
│  │ 3. S3 Data Source: Security Policies                 │     │
│  │    Bucket: s3://kendra-memories/policies/            │     │
│  │    Sync Schedule: Manual (rarely updated)            │     │
│  │    Metadata:                                         │     │
│  │      - policy_id                                     │     │
│  │      - enforcement_level                             │     │
│  │      - last_review_date                              │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Custom Attributes (Facets):                                   │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ - _severity (String: CRITICAL, HIGH, MEDIUM, LOW)    │     │
│  │ - _repo_name (String)                                │     │
│  │ - _timestamp (Date)                                  │     │
│  │ - _pattern_type (String)                             │     │
│  │ - _agent_consensus_score (Number: 0.0-1.0)           │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Query Example (from Agent):                                   │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ kendra.retrieve(                                     │     │
│  │   IndexId='abc-123-def',                             │     │
│  │   QueryText='SQL injection in authentication code',  │     │
│  │   AttributeFilter={                                  │     │
│  │     'AndAllFilters': [                               │     │
│  │       {                                              │     │
│  │         'EqualsTo': {                                │     │
│  │           'Key': '_repo_name',                       │     │
│  │           'Value': {'StringValue': 'auth-service'}   │     │
│  │         }                                            │     │
│  │       },                                             │     │
│  │       {                                              │     │
│  │         'GreaterThanOrEquals': {                     │     │
│  │           'Key': '_agent_consensus_score',           │     │
│  │           'Value': {'LongValue': 0.7}                │     │
│  │         }                                            │     │
│  │       }                                              │     │
│  │     ]                                                │     │
│  │   }                                                  │     │
│  │ )                                                    │     │
│  │                                                      │     │
│  │ Returns:                                             │     │
│  │   [                                                  │     │
│  │     {                                                │     │
│  │       "DocumentTitle": "SQL Injection in auth.py",  │     │
│  │       "DocumentURI": "s3://kendra-memories/...",    │     │
│  │       "DocumentExcerpt": "Parameterized queries...",│     │
│  │       "ScoreAttributes": {                           │     │
│  │         "ScoreConfidence": "HIGH"                    │     │
│  │       },                                             │     │
│  │       "DocumentAttributes": {                        │     │
│  │         "_severity": "CRITICAL",                     │     │
│  │         "_timestamp": "2024-08-15T12:00:00Z"         │     │
│  │       }                                              │     │
│  │     },                                               │     │
│  │     ...                                              │     │
│  │   ]                                                  │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. DATA ARCHITECTURE & RETRIEVAL PATTERNS

### 6.1 DynamoDB Tables

```
┌────────────────────────────────────────────────────────────────┐
│                    DYNAMODB TABLE SCHEMAS                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Table: FindingsArchive                                        │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Partition Key (PK): finding_id (String)              │     │
│  │ Sort Key (SK): timestamp (Number, Unix epoch)        │     │
│  │                                                      │     │
│  │ Attributes:                                          │     │
│  │   - mission_id: String                               │     │
│  │   - repo_name: String                                │     │
│  │   - title: String                                    │     │
│  │   - description: String (max 4KB)                    │     │
│  │   - severity: String (CRITICAL|HIGH|MEDIUM|LOW)      │     │
│  │   - confidence_score: Number (0.0-1.0)               │     │
│  │   - evidence_chain: List<Map>                        │     │
│  │       [                                              │     │
│  │         {                                            │     │
│  │           "tool": "semgrep-mcp",                     │     │
│  │           "digest": "sha256:abc...",                 │     │
│  │           "s3_uri": "s3://...",                      │     │
│  │           "line_numbers": [42, 43, 44]               │     │
│  │         }                                            │     │
│  │       ]                                              │     │
│  │   - agent_votes: Map<String, Number>                 │     │
│  │       {                                              │     │
│  │         "synthesizer": 0.87,                         │     │
│  │         "critic": 0.91,                              │     │
│  │         "archivist": 1.0                             │     │
│  │       }                                              │     │
│  │   - negotiation_rounds: Number                       │     │
│  │   - created_at: String (ISO 8601)                    │     │
│  │   - ttl: Number (5 years retention)                  │     │
│  │                                                      │     │
│  │ Global Secondary Indexes:                            │     │
│  │   GSI1: repo_name-timestamp-index                    │     │
│  │     PK: repo_name | SK: timestamp                    │     │
│  │   GSI2: severity-timestamp-index                     │     │
│  │     PK: severity | SK: timestamp                     │     │
│  │                                                      │     │
│  │ Provisioned: On-Demand                               │     │
│  │ Point-in-Time Recovery: Enabled                      │     │
│  │ Encryption: KMS (HivemindKey)                        │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Table: MissionStatus                                          │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Partition Key (PK): mission_id (String)              │     │
│  │                                                      │     │
│  │ Attributes:                                          │     │
│  │   - status: String (PENDING|UNPACKING|ANALYZING|     │     │
│  │              SYNTHESIZING|COMPLETED|FAILED)          │     │
│  │   - repo_name: String                                │     │
│  │   - uploader_arn: String                             │     │
│  │   - code_sha256: String                              │     │
│  │   - started_at: String (ISO 8601)                    │     │
│  │   - last_updated: String (ISO 8601)                  │     │
│  │   - active_agents: List<String>                      │     │
│  │   - completed_agents: List<String>                   │     │
│  │   - findings_count: Number                           │     │
│  │   - error_message: String (if FAILED)                │     │
│  │   - ttl: Number (30 days retention)                  │     │
│  │                                                      │     │
│  │ Stream: Enabled (NEW_AND_OLD_IMAGES)                 │     │
│  │   → Triggers Lambda for status notifications         │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Table: ToolResultsIndex                                       │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Partition Key (PK): mission_id (String)              │     │
│  │ Sort Key (SK): tool#timestamp (String)               │     │
│  │   Format: "semgrep-mcp#1729404000"                   │     │
│  │                                                      │     │
│  │ Attributes:                                          │     │
│  │   - tool_name: String                                │     │
│  │   - s3_uri: String                                   │     │
│  │   - digest: String (sha256:...)                      │     │
│  │   - findings_count: Number                           │     │
│  │   - execution_duration_ms: Number                    │     │
│  │   - success: Boolean                                 │     │
│  │   - error_message: String (if failed)                │     │
│  │                                                      │     │
│  │ Purpose: Fast lookup of tool outputs by agents       │     │
│  │ TTL: 7 days (results archived in S3 long-term)       │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 6.2 Tool Result Retrieval Pattern

```
┌────────────────────────────────────────────────────────────────┐
│              TOOL RESULT STORAGE & RETRIEVAL                   │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Phase 1: Tool Execution (MCP Server)                          │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ MCP Tool (Fargate Task): semgrep-mcp                 │     │
│  │                                                      │     │
│  │ 1. Scan code in S3                                   │     │
│  │    s3://hivemind-artifacts/unzipped/{mission_id}/    │     │
│  │                                                      │     │
│  │ 2. Generate results JSON                             │     │
│  │    {                                                 │     │
│  │      "findings": [                                   │     │
│  │        {                                             │     │
│  │          "rule_id": "python.lang.security.sql-inject", │   │
│  │          "file": "auth.py",                          │     │
│  │          "lines": [42],                              │     │
│  │          "severity": "ERROR",                        │     │
│  │          "message": "Possible SQL injection"         │     │
│  │        }                                             │     │
│  │      ],                                              │     │
│  │      "metadata": {                                   │     │
│  │        "tool": "semgrep",                            │     │
│  │        "version": "1.45.0",                          │     │
│  │        "scan_duration_ms": 2341                      │     │
│  │      }                                               │     │
│  │    }                                                 │     │
│  │                                                      │     │
│  │ 3. Compute digest                                    │     │
│  │    digest = sha256(json_bytes)                       │     │
│  │    → "sha256:abc123..."                              │     │
│  │                                                      │     │
│  │ 4. Write to S3                                       │     │
│  │    Key: tool-results/semgrep-mcp/{mission_id}/       │     │
│  │         {timestamp}/results.json                     │     │
│  │                                                      │     │
│  │ 5. Write digest file                                 │     │
│  │    Key: tool-results/semgrep-mcp/{mission_id}/       │     │
│  │         {timestamp}/digest.sha256                    │     │
│  │    Content: "sha256:abc123..."                       │     │
│  │                                                      │     │
│  │ 6. Index in DynamoDB                                 │     │
│  │    PutItem:                                          │     │
│  │      PK: mission_id                                  │     │
│  │      SK: "semgrep-mcp#{timestamp}"                   │     │
│  │      s3_uri: "s3://hivemind-artifacts/tool-results/...", │  │
│  │      digest: "sha256:abc123...",                     │     │
│  │      findings_count: 1,                              │     │
│  │      success: true                                   │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Phase 2: Result Retrieval (Synthesizer Agent)                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. Query DynamoDB for all tool results               │     │
│  │    Query:                                            │     │
│  │      PK = mission_id                                 │     │
│  │      SK begins_with "semgrep-mcp#"                   │     │
│  │                                                      │     │
│  │    Returns:                                          │     │
│  │      [                                               │     │
│  │        {                                             │     │
│  │          "s3_uri": "s3://.../results.json",          │     │
│  │          "digest": "sha256:abc123...",               │     │
│  │          "findings_count": 1                         │     │
│  │        }                                             │     │
│  │      ]                                               │     │
│  │                                                      │     │
│  │ 2. Fetch results from S3                             │     │
│  │    results = s3.get_object(uri)                      │     │
│  │                                                      │     │
│  │ 3. Verify digest                                     │     │
│  │    assert sha256(results) == stored_digest           │     │
│  │                                                      │     │
│  │ 4. Parse and analyze                                 │     │
│  │    findings = json.loads(results)                    │     │
│  │                                                      │     │
│  │ 5. Cite in evidence chain                            │     │
│  │    evidence = {                                      │     │
│  │      "tool": "semgrep-mcp",                          │     │
│  │      "digest": "sha256:abc123...",                   │     │
│  │      "s3_uri": "s3://.../results.json",              │     │
│  │      "line_numbers": [42]                            │     │
│  │    }                                                 │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Phase 3: Cryptographic Verification (Audit)                  │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Any party can verify a finding's evidence chain:     │     │
│  │                                                      │     │
│  │ 1. Read finding from FindingsArchive                 │     │
│  │ 2. For each evidence in evidence_chain:              │     │
│  │      - Fetch raw tool output from S3 using s3_uri    │     │
│  │      - Compute SHA256 of content                     │     │
│  │      - Assert computed == stored digest              │     │
│  │ 3. If all digests match → Evidence chain verified    │     │
│  │                                                      │     │
│  │ This creates non-repudiable audit trail              │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. SECURITY & IAM MODEL

### 7.1 IAM Role Hierarchy

```
┌────────────────────────────────────────────────────────────────┐
│                      IAM ROLE STRUCTURE                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Developer/CI Roles (External)                                 │
│  ├─ arn:aws:iam::123456789:role/DeveloperRole                  │
│  │  Trust: SAML/OIDC provider                                  │
│  │  Permissions:                                               │
│  │    - sts:AssumeRole on HivemindCliUserRole                  │
│  │                                                             │
│  └─ arn:aws:iam::123456789:role/CIRole                         │
│     Trust: GitHub Actions                                      │
│     Permissions:                                               │
│       - sts:AssumeRole on HivemindCliUserRole                  │
│                                                                │
│  ─────────────────────────────────────────────────────────────│
│                                                                │
│  Application Roles (Hivemind Platform)                         │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ HivemindCliUserRole                                  │     │
│  │   Trust: DeveloperRole, CIRole                       │     │
│  │   Permissions:                                       │     │
│  │     - s3:PutObject on hivemind-uploads/*             │     │
│  │     - s3:GetObject on hivemind-uploads/*             │     │
│  │       Condition: s3:userid == ${aws:userid}          │     │
│  │     - dynamodb:GetItem on MissionStatus              │     │
│  │     - dynamodb:Query on MissionStatus                │     │
│  │       Condition: PK starts with ${aws:userid}        │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ StepFunctionsOrchestratorRole                        │     │
│  │   Trust: states.amazonaws.com                        │     │
│  │   Permissions:                                       │     │
│  │     - lambda:InvokeFunction on UnpackLambda          │     │
│  │     - ecs:RunTask on agent task definitions          │     │
│  │     - ecs:RunTask on MCP task definitions            │     │
│  │     - iam:PassRole on all task roles                 │     │
│  │     - dynamodb:UpdateItem on MissionStatus           │     │
│  │     - sns:Publish on notification topics             │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ ArchaeologistTaskRole                                │     │
│  │   Trust: ecs-tasks.amazonaws.com                     │     │
│  │   Permissions:                                       │     │
│  │     - s3:GetObject on hivemind-artifacts/unzipped/*  │     │
│  │     - s3:PutObject on hivemind-artifacts/agent-*/    │     │
│  │     - bedrock:InvokeModel (Claude, Titan)            │     │
│  │     - kendra:Retrieve on institutional-memory index  │     │
│  │     - dynamodb:GetItem on ToolResultsIndex           │     │
│  │     - dynamodb:Query on ToolResultsIndex             │     │
│  │     - secretsmanager:GetSecretValue (Redis creds)    │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  [Similar roles for: Strategist, Coordinator, Synthesizer,    │
│   Critic, Archivist agents - each with minimal permissions]   │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ MCPServerTaskRole                                    │     │
│  │   Trust: ecs-tasks.amazonaws.com                     │     │
│  │   Permissions:                                       │     │
│  │     - s3:GetObject on hivemind-artifacts/unzipped/*  │     │
│  │       (read-only access to source code)              │     │
│  │     - s3:PutObject on hivemind-artifacts/tool-*/     │     │
│  │       (write-only access to results)                 │     │
│  │     - dynamodb:PutItem on ToolResultsIndex           │     │
│  │     - NO bedrock, kendra, or cross-mission access    │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ MemoryIngestorLambdaRole                             │     │
│  │   Trust: lambda.amazonaws.com                        │     │
│  │   Permissions:                                       │     │
│  │     - dynamodb:GetItem on FindingsArchive            │     │
│  │     - s3:PutObject on kendra-memories/*              │     │
│  │     - kendra:BatchPutDocument                        │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 7.2 KMS Key Policy

```
┌────────────────────────────────────────────────────────────────┐
│                   KMS KEY: HivemindKey                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Key ID: arn:aws:kms:us-east-1:123456789:key/abc-def-ghi      │
│  Alias: alias/hivemind-platform                                │
│  Key Policy:                                                   │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ {                                                    │     │
│  │   "Statement": [                                     │     │
│  │     {                                                │     │
│  │       "Sid": "Enable IAM policies",                  │     │
│  │       "Effect": "Allow",                             │     │
│  │       "Principal": {                                 │     │
│  │         "AWS": "arn:aws:iam::123456789:root"         │     │
│  │       },                                             │     │
│  │       "Action": "kms:*",                             │     │
│  │       "Resource": "*"                                │     │
│  │     },                                               │     │
│  │     {                                                │     │
│  │       "Sid": "Allow S3 to use key",                  │     │
│  │       "Effect": "Allow",                             │     │
│  │       "Principal": {                                 │     │
│  │         "Service": "s3.amazonaws.com"                │     │
│  │       },                                             │     │
│  │       "Action": [                                    │     │
│  │         "kms:Decrypt",                               │     │
│  │         "kms:GenerateDataKey"                        │     │
│  │       ],                                             │     │
│  │       "Resource": "*",                               │     │
│  │       "Condition": {                                 │     │
│  │         "StringEquals": {                            │     │
│  │           "kms:ViaService": "s3.us-east-1.amazonaws.com", │ │
│  │           "kms:EncryptionContext:aws:s3:arn": [      │     │
│  │             "arn:aws:s3:::hivemind-uploads",         │     │
│  │             "arn:aws:s3:::hivemind-artifacts",       │     │
│  │             "arn:aws:s3:::kendra-memories"           │     │
│  │           ]                                          │     │
│  │         }                                            │     │
│  │       }                                              │     │
│  │     },                                               │     │
│  │     {                                                │     │
│  │       "Sid": "Allow DynamoDB to use key",            │     │
│  │       "Effect": "Allow",                             │     │
│  │       "Principal": {                                 │     │
│  │         "Service": "dynamodb.amazonaws.com"          │     │
│  │       },                                             │     │
│  │       "Action": [                                    │     │
│  │         "kms:Decrypt",                               │     │
│  │         "kms:DescribeKey",                           │     │
│  │         "kms:CreateGrant"                            │     │
│  │       ],                                             │     │
│  │       "Resource": "*",                               │     │
│  │       "Condition": {                                 │     │
│  │         "StringEquals": {                            │     │
│  │           "kms:ViaService": "dynamodb.us-east-1...", │     │
│  │         }                                            │     │
│  │       }                                              │     │
│  │     }                                                │     │
│  │   ]                                                  │     │
│  │ }                                                    │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Rotation: Enabled (Automatic annual rotation)                │
└────────────────────────────────────────────────────────────────┘
```

### 7.3 Security Groups

```
┌────────────────────────────────────────────────────────────────┐
│                      SECURITY GROUPS                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  SG: agent-tasks-sg (ID: sg-abc123)                            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Inbound Rules: NONE                                  │     │
│  │                                                      │     │
│  │ Outbound Rules:                                      │     │
│  │   - 443 → VPC CIDR (for VPC endpoints)               │     │
│  │   - 6379 → elasticache-sg (Redis)                    │     │
│  │                                                      │     │
│  │ Attached To: All agent Fargate tasks                 │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  SG: mcp-tools-sg (ID: sg-def456)                              │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Inbound Rules: NONE                                  │     │
│  │                                                      │     │
│  │ Outbound Rules:                                      │     │
│  │   - 443 → VPC CIDR (for VPC endpoints)               │     │
│  │   - NO Redis access (MCP tools are stateless)        │     │
│  │                                                      │     │
│  │ Attached To: All MCP tool Fargate tasks              │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  SG: elasticache-sg (ID: sg-ghi789)                            │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Inbound Rules:                                       │     │
│  │   - 6379 ← agent-tasks-sg                            │     │
│  │                                                      │     │
│  │ Outbound Rules: NONE                                 │     │
│  │                                                      │     │
│  │ Attached To: ElastiCache cluster nodes               │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  SG: vpc-endpoints-sg (ID: sg-jkl012)                          │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Inbound Rules:                                       │     │
│  │   - 443 ← agent-tasks-sg                             │     │
│  │   - 443 ← mcp-tools-sg                               │     │
│  │                                                      │     │
│  │ Outbound Rules: 443 → 0.0.0.0/0 (AWS services)       │     │
│  │                                                      │     │
│  │ Attached To: All VPC interface endpoints             │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

---

## 8. WORKFLOW CHOREOGRAPHY

### 8.1 Step Functions State Machine

```
┌────────────────────────────────────────────────────────────────┐
│          STEP FUNCTIONS: AgenticOrchestrator (ASL)             │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  State Machine ARN:                                            │
│    arn:aws:states:us-east-1:123:stateMachine:AgenticOrch      │
│                                                                │
│  Input:                                                        │
│    {                                                           │
│      "mission_id": "uuid-from-eventbridge",                    │
│      "s3_source_uri": "s3://hivemind-uploads/...",            │
│      "repo_name": "auth-service",                              │
│      "code_sha256": "abc123..."                                │
│    }                                                           │
│                                                                │
│  States:                                                       │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 1. UnpackAndValidate (Lambda Task)                   │     │
│  │    Type: Task                                        │     │
│  │    Resource: arn:aws:lambda:::UnpackLambda           │     │
│  │    Input: ${input}                                   │     │
│  │    ResultPath: $.unpack_result                       │     │
│  │    Catch:                                            │     │
│  │      - ErrorEquals: [States.ALL]                     │     │
│  │        Next: HandleFailure                           │     │
│  │    Next: DeployContextAgents                         │     │
│  │                                                      │     │
│  │    Lambda Logic:                                     │     │
│  │      - Download archive from S3                      │     │
│  │      - Verify checksum                               │     │
│  │      - Extract to unzipped/{mission_id}/             │     │
│  │      - Run ClamAV scan (basic malware check)         │     │
│  │      - Update MissionStatus: UNPACKING → ANALYZING   │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 2. DeployContextAgents (Parallel State)              │     │
│  │    Type: Parallel                                    │     │
│  │    Branches:                                         │     │
│  │      - ArchaeologistTask                             │     │
│  │      - StrategistTask (waits for Archaeologist)      │     │
│  │                                                      │     │
│  │    Each Branch is ECS RunTask:                       │     │
│  │      Type: Task                                      │     │
│  │      Resource: arn:aws:states:::ecs:runTask.sync     │     │
│  │      Parameters:                                     │     │
│  │        Cluster: hivemind-cluster                     │     │
│  │        TaskDefinition: archaeologist-agent:v3        │     │
│  │        LaunchType: FARGATE                           │     │
│  │        NetworkConfiguration:                         │     │
│  │          AwsvpcConfiguration:                        │     │
│  │            Subnets: [private-subnet-a, -b]           │     │
│  │            SecurityGroups: [agent-tasks-sg]          │     │
│  │            AssignPublicIp: DISABLED                  │     │
│  │        Overrides:                                    │     │
│  │          ContainerOverrides:                         │     │
│  │            - Name: archaeologist-container           │     │
│  │              Environment:                            │     │
│  │                - Name: MISSION_ID                    │     │
│  │                  Value: $.mission_id                 │     │
│  │                - Name: S3_ARTIFACTS_BUCKET           │     │
│  │                  Value: hivemind-artifacts           │     │
│  │                                                      │     │
│  │    ResultPath: $.context_results                     │     │
│  │    Next: CoordinatorDecision                         │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 3. CoordinatorDecision (ECS Task)                    │     │
│  │    Type: Task                                        │     │
│  │    Resource: arn:aws:states:::ecs:runTask.sync       │     │
│  │    Parameters:                                       │     │
│  │      TaskDefinition: coordinator-agent:v3            │     │
│  │      [Similar network config]                        │     │
│  │                                                      │     │
│  │    Agent Logic:                                      │     │
│  │      - Read context from previous agents             │     │
│  │      - Query Kendra for similar missions             │     │
│  │      - Decide which MCP tools to invoke              │     │
│  │      - Generate execution plan                       │     │
│  │      - Write to ElastiCache: resource allocation     │     │
│  │                                                      │     │
│  │    ResultPath: $.execution_plan                      │     │
│  │    Next: DynamicMCPInvocation                        │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 4. DynamicMCPInvocation (Map State)                  │     │
│  │    Type: Map                                         │     │
│  │    ItemsPath: $.execution_plan.tools                 │     │
│  │    MaxConcurrency: 5                                 │     │
│  │    Iterator:                                         │     │
│  │      StartAt: InvokeMCPTool                          │     │
│  │      States:                                         │     │
│  │        InvokeMCPTool:                                │     │
│  │          Type: Task                                  │     │
│  │          Resource: arn:aws:states:::ecs:runTask.sync │     │
│  │          Parameters:                                 │     │
│  │            TaskDefinition.$: $.task_definition       │     │
│  │            [Network config]                          │     │
│  │                                                      │     │
│  │    Example Tools Invoked (based on Coordinator):     │     │
│  │      - semgrep-mcp (Python SAST)                     │     │
│  │      - gitleaks-mcp (Secret scanning)                │     │
│  │      - trivy-mcp (Dependency vulnerabilities)        │     │
│  │      - custom-mcp-auth (Domain-specific analyzer)    │     │
│  │                                                      │     │
│  │    ResultPath: $.mcp_results                         │     │
│  │    Next: WaitForAllTools                             │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 5. WaitForAllTools (Wait State)                      │     │
│  │    Type: Wait                                        │     │
│  │    Seconds: 5                                        │     │
│  │    Comment: "Allow S3 eventual consistency"          │     │
│  │    Next: LaunchSynthesisCrucible                     │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 6. LaunchSynthesisCrucible (Parallel State)          │     │
│  │    Type: Parallel                                    │     │
│  │    Branches:                                         │     │
│  │      - SynthesizerTask (drafts findings)             │     │
│  │      - CriticTask (challenges findings, sequential)  │     │
│  │                                                      │     │
│  │    SynthesizerTask:                                  │     │
│  │      - Reads all tool results from S3                │     │
│  │      - Queries Kendra for context enrichment         │     │
│  │      - Invokes Bedrock to draft findings             │     │
│  │      - Writes proposals to ElastiCache               │     │
│  │                                                      │     │
│  │    CriticTask (Depends on Synthesizer output):       │     │
│  │      - Waits for proposals in ElastiCache            │     │
│  │      - Challenges each finding                       │     │
│  │      - Queries Kendra for counter-evidence           │     │
│  │      - Writes counter-proposals                      │     │
│  │                                                      │     │
│  │    Negotiation happens in ElastiCache via protocol   │     │
│  │    described in Section 2.3                          │     │
│  │                                                      │     │
│  │    ResultPath: $.synthesis_results                   │     │
│  │    Next: WaitForConsensus                            │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 7. WaitForConsensus (Wait State)                     │     │
│  │    Type: Wait                                        │     │
│  │    Seconds: 10                                       │     │
│  │    Comment: "Allow negotiation to complete"          │     │
│  │    Next: ArchivistTask                               │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 8. ArchivistTask (ECS Task)                          │     │
│  │    Type: Task                                        │     │
│  │    Resource: arn:aws:states:::ecs:runTask.sync       │     │
│  │    Parameters:                                       │     │
│  │      TaskDefinition: archivist-agent:v3              │     │
│  │                                                      │     │
│  │    Agent Logic:                                      │     │
│  │      - Read consensus findings from ElastiCache      │     │
│  │      - Write to DynamoDB FindingsArchive             │     │
│  │      - Trigger MemoryIngestorLambda                  │     │
│  │      - Update MissionStatus: COMPLETED               │     │
│  │      - Clean up ElastiCache keys                     │     │
│  │                                                      │     │
│  │    ResultPath: $.archival_result                     │     │
│  │    Next: NotifyCompletion                            │     │
│  └──────────────────────────────────────────────────────┘     │
│                          │                                     │
│                          ▼                                     │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ 9. NotifyCompletion (SNS Task)                       │     │
│  │    Type: Task                                        │     │
│  │    Resource: arn:aws:states:::sns:publish            │     │
│  │    Parameters:                                       │     │
│  │      TopicArn: arn:aws:sns:::hivemind-completions    │     │
│  │      Message:                                        │     │
│  │        mission_id: $.mission_id                      │     │
│  │        status: COMPLETED                             │     │
│  │        findings_count: $.archival_result.count       │     │
│  │    End: true                                         │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  Error Handling:                                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ HandleFailure (Lambda Task)                          │     │
│  │   - Log error details to CloudWatch                  │     │
│  │   - Update MissionStatus: FAILED                     │     │
│  │   - Send SNS alert                                   │     │
│  │   - End: true                                        │     │
│  └──────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────┘
```

### 8.2 End-to-End Timeline

```
┌────────────────────────────────────────────────────────────────┐
│               TYPICAL MISSION TIMELINE                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  T+0s:   Developer runs: hivemind scan --path . --repo auth   │
│          CLI uploads to S3, receives mission_id                │
│                                                                │
│  T+2s:   S3 event → EventBridge → Step Functions starts       │
│          Status: PENDING → UNPACKING                           │
│                                                                │
│  T+5s:   UnpackLambda completes                                │
│          Source code extracted, malware scan passed            │
│          Status: ANALYZING                                     │
│                                                                │
│  T+8s:   ArchaeologistAgent launches                           │
│          Discovers: Tier-0 service, handles PII                │
│                                                                │
│  T+15s:  StrategistAgent completes                             │
│          Queries Kendra: "auth-service past findings"          │
│          Decides: semgrep, gitleaks, custom-auth-mcp           │
│                                                                │
│  T+18s:  CoordinatorAgent allocates resources                  │
│          3 Fargate tasks for MCP tools                         │
│                                                                │
│  T+20s:  MCP tools launch in parallel                          │
│          - semgrep-mcp scans Python code                       │
│          - gitleaks-mcp scans for secrets                      │
│          - custom-auth-mcp analyzes auth flows                 │
│                                                                │
│  T+45s:  All MCP tools complete                                │
│          Results written to S3 + indexed in DynamoDB           │
│          - semgrep: 3 findings                                 │
│          - gitleaks: 1 finding                                 │
│          - custom-auth-mcp: 2 findings                         │
│                                                                │
│  T+50s:  SynthesizerAgent launches                             │
│          Reads 6 total findings from tool results              │
│          Queries Kendra for enrichment                         │
│          Drafts 4 preliminary findings (2 duplicates merged)   │
│          Writes proposals to ElastiCache                       │
│                                                                │
│  T+65s:  CriticAgent launches                                  │
│          Reads proposals from ElastiCache                      │
│          Challenges: "SQL injection severity"                  │
│          Queries Kendra: "parameterized queries in Python"     │
│          Counter-proposes: Downgrade to HIGH (from CRITICAL)   │
│                                                                │
│  T+75s:  Negotiation phase                                     │
│          SynthesizerAgent queries Kendra again                 │
│          Finds: "Lines 50-55 do not protect line 42"           │
│          Synthesizer maintains: CRITICAL                       │
│          CriticAgent revises: CRITICAL (consensus reached)     │
│                                                                │
│  T+80s:  ArchivistAgent launches                               │
│          Reads consensus findings                              │
│          Writes 4 findings to DynamoDB                         │
│          Each with: evidence_chain, agent_votes, digests       │
│          Triggers MemoryIngestorLambda                         │
│          Status: COMPLETED                                     │
│                                                                │
│  T+85s:  MemoryIngestorLambda creates Kendra documents         │
│          New memories available for future missions            │
│                                                                │
│  T+90s:  SNS notification sent                                 │
│          CLI (if --wait) displays final results                │
│                                                                │
│  Total Duration: ~90 seconds                                   │
│  Resource Cost: ~$0.15 (Fargate + Bedrock + Kendra queries)    │
└────────────────────────────────────────────────────────────────┘
```

---

## 9. CLI TOOL SPECIFICATION

### 9.1 CLI Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                  HIVEMIND-CLI DESIGN                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Language: Python 3.12                                         │
│  Package Name: hivemind-cli                                    │
│  Distribution: PyPI (cross-platform)                           │
│                                                                │
│  Dependencies:                                                 │
│    - boto3>=1.28.0 (AWS SDK for Python)                        │
│    - click>=8.1.0 (CLI framework)                              │
│    - rich>=13.0.0 (terminal progress and formatting)           │
│    - pydantic>=2.0.0 (data validation)                         │
│    - cryptography>=41.0.0 (SHA256 hashing)                     │
│                                                                │
│  Installation:                                                 │
│    pip install hivemind-cli                                    │
│                                                                │
│  Python Package Structure:                                     │
│    hivemind_cli/                                               │
│      __init__.py                                               │
│      cli.py           (Click command definitions)              │
│      uploader.py      (S3 upload logic)                        │
│      archive.py       (tarball creation)                       │
│      status.py        (DynamoDB status polling)                │
│      auth.py          (IAM role assumption via STS)            │
│      models.py        (Pydantic data models)                   │
│                                                                │
│  Entry Point:                                                  │
│    Console script: hivemind                                    │
│                                                                │
│  Platform Support:                                             │
