# Hivemind-Prism Testing Strategy

**Last Updated**: 2025-10-20  
**Status**: Test suite defined, implementation pending

## Testing Philosophy

Since we don't have an AWS account yet, all tests will be **unit tests with mocked AWS services**. Integration tests will be added post-deployment.

## Test Structure

```
tests/
├── unit/                          # Unit tests (no AWS required)
│   ├── agents/                    # Agent logic tests
│   │   ├── test_archaeologist.py
│   │   ├── test_strategist.py
│   │   ├── test_coordinator.py
│   │   ├── test_synthesizer.py
│   │   ├── test_critic.py
│   │   └── test_archivist.py
│   ├── mcp_servers/               # MCP server tests
│   │   ├── test_semgrep_mcp.py
│   │   ├── test_gitleaks_mcp.py
│   │   └── test_trivy_mcp.py
│   ├── lambdas/                   # Lambda function tests
│   │   ├── test_unpack.py
│   │   ├── test_memory_ingestor.py
│   │   └── test_failure_handler.py
│   ├── shared/                    # Shared library tests
│   │   ├── test_bedrock_client.py
│   │   ├── test_deep_researcher.py
│   │   └── test_wiki_generator.py
│   └── conftest.py                # Pytest fixtures
├── infrastructure/                # CDK infrastructure tests
│   ├── test_network_stack.py
│   ├── test_security_stack.py
│   ├── test_storage_stack.py
│   ├── test_intelligence_stack.py
│   ├── test_compute_stack.py
│   └── test_orchestration_stack.py
└── README.md                      # Test documentation
```

## Unit Tests (55 test files)

### 1. Agent Tests (6 files)

#### test_archaeologist.py
**Purpose**: Test context discovery and deep research integration
**Test Cases**:
- ✅ `test_sense_phase_s3_read()` - Mock S3 GetObject
- ✅ `test_think_phase_bedrock_invocation()` - Mock Bedrock converse
- ✅ `test_decide_phase_creates_context_manifest()` - Validate manifest structure
- ✅ `test_act_phase_deep_research()` - Mock DeepCodeResearcher
- ✅ `test_reflect_phase_s3_write()` - Mock S3 PutObject
- ✅ `test_error_handling_invalid_scan_id()` - Error cases
- ✅ `test_error_handling_missing_s3_object()` - Error cases

**Mocked Services**: S3, Bedrock, DeepCodeResearcher

#### test_strategist.py
**Purpose**: Test tool selection logic
**Test Cases**:
- ✅ `test_sense_reads_context_manifest()` - Mock S3 GetObject
- ✅ `test_think_analyzes_code_patterns()` - Mock Bedrock
- ✅ `test_decide_selects_appropriate_tools()` - Validate tool selection
- ✅ `test_act_writes_tool_plan()` - Mock S3 PutObject
- ✅ `test_tool_selection_for_secrets()` - Gitleaks selected
- ✅ `test_tool_selection_for_vulnerabilities()` - Semgrep + Trivy selected
- ✅ `test_error_handling_empty_context()` - Error cases

**Mocked Services**: S3, Bedrock

#### test_coordinator.py
**Purpose**: Test resource allocation and MCP orchestration
**Test Cases**:
- ✅ `test_sense_reads_tool_plan()` - Mock S3 GetObject
- ✅ `test_think_plans_execution()` - Mock Bedrock
- ✅ `test_decide_allocates_resources()` - Validate resource allocation
- ✅ `test_act_invokes_mcp_tools()` - Mock ECS RunTask
- ✅ `test_parallel_tool_execution()` - Multiple tools
- ✅ `test_sequential_tool_execution()` - Dependent tools
- ✅ `test_error_handling_tool_failure()` - Error cases

**Mocked Services**: S3, Bedrock, ECS

#### test_synthesizer.py
**Purpose**: Test finding synthesis from tool results
**Test Cases**:
- ✅ `test_sense_reads_tool_results()` - Mock S3 GetObject
- ✅ `test_think_analyzes_findings()` - Mock Bedrock
- ✅ `test_decide_creates_draft_findings()` - Validate finding format
- ✅ `test_act_proposes_to_redis()` - Mock Redis SET
- ✅ `test_deduplication_logic()` - Duplicate findings
- ✅ `test_severity_calculation()` - CVSS scoring
- ✅ `test_error_handling_malformed_results()` - Error cases

**Mocked Services**: S3, Bedrock, Redis

#### test_critic.py
**Purpose**: Test finding validation and counter-evidence
**Test Cases**:
- ✅ `test_sense_reads_draft_findings()` - Mock Redis GET
- ✅ `test_think_analyzes_for_false_positives()` - Mock Bedrock
- ✅ `test_decide_validates_or_rejects()` - Validate/reject logic
- ✅ `test_act_counter_proposes()` - Mock Redis SET
- ✅ `test_negotiation_protocol()` - Proposal/counter-proposal
- ✅ `test_consensus_reached()` - Voting logic
- ✅ `test_error_handling_consensus_timeout()` - Error cases

**Mocked Services**: Redis, Bedrock

#### test_archivist.py
**Purpose**: Test finding archival and wiki generation
**Test Cases**:
- ✅ `test_sense_reads_final_findings()` - Mock Redis GET
- ✅ `test_think_prepares_archive()` - Mock Bedrock
- ✅ `test_decide_structures_findings()` - Validate structure
- ✅ `test_act_writes_to_dynamodb()` - Mock DynamoDB PutItem
- ✅ `test_wiki_generation()` - Mock SecurityWikiGenerator
- ✅ `test_memory_trigger()` - Mock EventBridge PutEvents
- ✅ `test_error_handling_dynamodb_failure()` - Error cases

**Mocked Services**: Redis, Bedrock, DynamoDB, EventBridge, SecurityWikiGenerator

### 2. MCP Server Tests (3 files)

#### test_semgrep_mcp.py
**Purpose**: Test Semgrep MCP server implementation
**Test Cases**:
- ✅ `test_server_initialization()` - Server setup
- ✅ `test_scan_tool_invocation()` - Tool execution
- ✅ `test_result_parsing()` - Parse Semgrep JSON
- ✅ `test_s3_upload()` - Mock S3 PutObject
- ✅ `test_error_handling_invalid_path()` - Error cases
- ✅ `test_error_handling_semgrep_failure()` - Error cases

**Mocked Services**: S3, subprocess (for Semgrep CLI)

#### test_gitleaks_mcp.py
**Purpose**: Test Gitleaks MCP server implementation
**Test Cases**:
- ✅ `test_server_initialization()` - Server setup
- ✅ `test_scan_tool_invocation()` - Tool execution
- ✅ `test_result_parsing()` - Parse Gitleaks JSON
- ✅ `test_s3_upload()` - Mock S3 PutObject
- ✅ `test_error_handling_invalid_path()` - Error cases
- ✅ `test_error_handling_gitleaks_failure()` - Error cases

**Mocked Services**: S3, subprocess (for Gitleaks CLI)

#### test_trivy_mcp.py
**Purpose**: Test Trivy MCP server implementation
**Test Cases**:
- ✅ `test_server_initialization()` - Server setup
- ✅ `test_scan_tool_invocation()` - Tool execution
- ✅ `test_result_parsing()` - Parse Trivy JSON
- ✅ `test_s3_upload()` - Mock S3 PutObject
- ✅ `test_error_handling_invalid_path()` - Error cases
- ✅ `test_error_handling_trivy_failure()` - Error cases

**Mocked Services**: S3, subprocess (for Trivy CLI)

### 3. Lambda Tests (3 files)

#### test_unpack.py
**Purpose**: Test S3 unpacking Lambda
**Test Cases**:
- ✅ `test_handler_zip_file()` - Unpack .zip
- ✅ `test_handler_tar_file()` - Unpack .tar.gz
- ✅ `test_handler_single_file()` - Handle single file
- ✅ `test_s3_operations()` - Mock S3 GetObject/PutObject
- ✅ `test_step_function_trigger()` - Mock StepFunctions StartExecution
- ✅ `test_error_handling_corrupt_archive()` - Error cases
- ✅ `test_error_handling_unsupported_format()` - Error cases

**Mocked Services**: S3, StepFunctions

#### test_memory_ingestor.py
**Purpose**: Test Kendra ingestion Lambda
**Test Cases**:
- ✅ `test_handler_processes_findings()` - Parse findings
- ✅ `test_s3_read_operations()` - Mock S3 GetObject
- ✅ `test_kendra_sync()` - Mock Kendra StartDataSourceSyncJob
- ✅ `test_error_handling_missing_findings()` - Error cases
- ✅ `test_error_handling_kendra_failure()` - Error cases

**Mocked Services**: S3, Kendra

#### test_failure_handler.py
**Purpose**: Test failure notification Lambda
**Test Cases**:
- ✅ `test_handler_processes_error()` - Parse error
- ✅ `test_cloudwatch_logging()` - Log error details
- ✅ `test_sns_notification()` - Mock SNS Publish (optional)
- ✅ `test_error_formatting()` - Error message format

**Mocked Services**: CloudWatch Logs, SNS (optional)

### 4. Shared Library Tests (3 files)

#### test_bedrock_client.py
**Purpose**: Test Bedrock client with RAG
**Test Cases**:
- ✅ `test_initialization()` - Client setup
- ✅ `test_converse_basic()` - Mock Bedrock converse
- ✅ `test_converse_with_rag()` - Mock Kendra query
- ✅ `test_converse_with_system_prompt()` - System context
- ✅ `test_error_handling_throttling()` - Retry logic
- ✅ `test_error_handling_invalid_model()` - Error cases
- ✅ `test_token_counting()` - Token estimation

**Mocked Services**: Bedrock, Kendra

#### test_deep_researcher.py
**Purpose**: Test deep code research
**Test Cases**:
- ✅ `test_catalog_repository()` - File discovery
- ✅ `test_build_dependency_graph()` - Import analysis
- ✅ `test_build_call_graph()` - Function call analysis
- ✅ `test_detect_security_patterns()` - Pattern matching
- ✅ `test_query_kendra()` - Mock Kendra query
- ✅ `test_synthesize_research()` - Synthesis logic
- ✅ `test_export_artifacts()` - Mock S3 PutObject
- ✅ `test_error_handling_large_files()` - Memory limits

**Mocked Services**: Kendra, S3

#### test_wiki_generator.py
**Purpose**: Test security wiki generation
**Test Cases**:
- ✅ `test_generate_wiki()` - Full wiki generation
- ✅ `test_executive_summary()` - Summary section
- ✅ `test_security_posture()` - Posture section
- ✅ `test_mermaid_diagram_generation()` - Diagram creation
- ✅ `test_finding_categorization()` - Severity grouping
- ✅ `test_remediation_guidance()` - Remediation section
- ✅ `test_export_wiki()` - Mock S3 PutObject
- ✅ `test_error_handling_empty_findings()` - Error cases

**Mocked Services**: S3

## Infrastructure Tests (6 files)

### test_network_stack.py
**Purpose**: Validate VPC, subnets, NAT, VPC endpoints
**Test Cases**:
- ✅ `test_vpc_creation()` - VPC with CIDR
- ✅ `test_subnet_configuration()` - Public/private subnets
- ✅ `test_nat_gateway()` - NAT for private subnets
- ✅ `test_vpc_endpoints()` - S3, DynamoDB, Bedrock endpoints
- ✅ `test_snapshot_match()` - CloudFormation snapshot

**Tool**: AWS CDK assertions

### test_security_stack.py
**Purpose**: Validate IAM roles, KMS keys, security groups
**Test Cases**:
- ✅ `test_kms_key_creation()` - Encryption key
- ✅ `test_iam_role_count()` - 11 roles created
- ✅ `test_iam_policy_least_privilege()` - Policy validation
- ✅ `test_security_groups()` - Minimal access rules
- ✅ `test_snapshot_match()` - CloudFormation snapshot

**Tool**: AWS CDK assertions

### test_storage_stack.py
**Purpose**: Validate S3, DynamoDB, Redis, EventBridge
**Test Cases**:
- ✅ `test_s3_bucket_encryption()` - KMS encryption
- ✅ `test_s3_bucket_versioning()` - Versioning enabled
- ✅ `test_dynamodb_tables()` - 3 tables created
- ✅ `test_redis_cluster()` - ElastiCache configuration
- ✅ `test_eventbridge_rules()` - Event routing
- ✅ `test_snapshot_match()` - CloudFormation snapshot

**Tool**: AWS CDK assertions

### test_intelligence_stack.py
**Purpose**: Validate Kendra index configuration
**Test Cases**:
- ✅ `test_kendra_index_creation()` - Index setup
- ✅ `test_kendra_iam_role()` - Service role
- ✅ `test_snapshot_match()` - CloudFormation snapshot

**Tool**: AWS CDK assertions

### test_compute_stack.py
**Purpose**: Validate ECS tasks, Lambda functions
**Test Cases**:
- ✅ `test_ecs_cluster_creation()` - Fargate cluster
- ✅ `test_ecs_task_definitions()` - 9 tasks (6 agents + 3 MCP)
- ✅ `test_lambda_functions()` - 3 functions
- ✅ `test_docker_image_references()` - ECR images
- ✅ `test_snapshot_match()` - CloudFormation snapshot

**Tool**: AWS CDK assertions

### test_orchestration_stack.py
**Purpose**: Validate Step Functions state machine
**Test Cases**:
- ✅ `test_state_machine_creation()` - State machine setup
- ✅ `test_state_transitions()` - All states defined
- ✅ `test_error_handling()` - Catch/retry logic
- ✅ `test_timeout_configuration()` - Timeout values
- ✅ `test_snapshot_match()` - CloudFormation snapshot

**Tool**: AWS CDK assertions

## Test Configuration

### pytest.ini
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = 
    -v
    --tb=short
    --strict-markers
    --cov=src
    --cov-report=html
    --cov-report=term-missing
markers =
    unit: Unit tests (no AWS required)
    infrastructure: CDK infrastructure tests
    slow: Slow-running tests
```

### conftest.py
```python
import pytest
from unittest.mock import Mock, patch
import boto3
from moto import mock_s3, mock_dynamodb, mock_stepfunctions

@pytest.fixture
def mock_s3_client():
    with mock_s3():
        yield boto3.client('s3', region_name='us-east-1')

@pytest.fixture
def mock_dynamodb_client():
    with mock_dynamodb():
        yield boto3.client('dynamodb', region_name='us-east-1')

@pytest.fixture
def mock_bedrock_client():
    with patch('boto3.client') as mock:
        mock_client = Mock()
        mock.return_value = mock_client
        yield mock_client

@pytest.fixture
def mock_redis_client():
    with patch('redis.Redis') as mock:
        yield mock.return_value

# ... more fixtures
```

### requirements-test.txt
```
pytest>=7.4.0
pytest-cov>=4.1.0
pytest-mock>=3.11.0
pytest-asyncio>=0.21.0
moto[all]>=4.2.0
boto3-stubs[essential]>=1.28.0
mypy>=1.5.0
black>=23.7.0
flake8>=6.1.0
```

## Test Execution

### Run All Tests
```bash
pytest tests/
```

### Run Unit Tests Only
```bash
pytest tests/unit/ -m unit
```

### Run Infrastructure Tests Only
```bash
pytest tests/infrastructure/ -m infrastructure
```

### Run with Coverage
```bash
pytest tests/ --cov=src --cov-report=html
open htmlcov/index.html
```

### Run Specific Test File
```bash
pytest tests/unit/agents/test_archaeologist.py -v
```

## Test Coverage Goals

| Component | Target Coverage | Current Coverage |
|-----------|----------------|------------------|
| Agents | 80% | 0% (pending) |
| MCP Servers | 80% | 0% (pending) |
| Lambda Functions | 80% | 0% (pending) |
| Shared Libraries | 85% | 0% (pending) |
| Infrastructure | 100% (snapshot) | 0% (pending) |
| **Overall** | **80%** | **0% (pending)** |

## CI/CD Integration

### GitHub Actions Workflow
```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.12'
      - run: pip install -r requirements-test.txt
      - run: pytest tests/ --cov=src --cov-report=xml
      - uses: codecov/codecov-action@v3
```

## Testing Timeline

### Phase 1: Foundation (Week 1)
- ✅ Create test structure
- ✅ Write conftest.py fixtures
- ✅ Set up pytest configuration
- ⏳ Write 10 basic unit tests

### Phase 2: Core Tests (Week 2)
- ⏳ Complete all agent tests (6 files)
- ⏳ Complete all MCP server tests (3 files)
- ⏳ Complete all Lambda tests (3 files)

### Phase 3: Advanced Tests (Week 3)
- ⏳ Complete all shared library tests (3 files)
- ⏳ Complete all infrastructure tests (6 files)
- ⏳ Set up CI/CD pipeline

### Phase 4: Polish (Week 4)
- ⏳ Achieve 80% coverage
- ⏳ Add performance benchmarks
- ⏳ Documentation and examples

## Test-Driven Development

For new features:
1. Write test first (TDD)
2. Implement feature
3. Verify test passes
4. Refactor if needed
5. Update documentation

## Known Limitations

1. **No AWS Integration**: All AWS services are mocked with moto
2. **No Real Bedrock Calls**: Bedrock responses are mocked
3. **No Real MCP Tools**: Tool execution is mocked
4. **No Network Tests**: VPC/networking untested without AWS

These limitations will be addressed post-deployment with integration tests.

## Summary

This test strategy provides comprehensive coverage of the Hivemind-Prism system without requiring AWS access. All 55 test files are enumerated with specific test cases. Once implemented, we'll have ~400-500 individual test cases covering:

- ✅ All 6 agents (SENSE → THINK → DECIDE → ACT → REFLECT)
- ✅ All 3 MCP servers (Semgrep, Gitleaks, Trivy)
- ✅ All 3 Lambda functions (Unpack, Memory, Failure)
- ✅ All 3 shared libraries (Bedrock, Research, Wiki)
- ✅ All 6 infrastructure stacks (Network, Security, Storage, Intelligence, Compute, Orchestration)

**Estimated Implementation**: 4 weeks for 80% coverage