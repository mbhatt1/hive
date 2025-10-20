"""
Pytest Configuration and Fixtures
==================================

Provides reusable fixtures for testing Hivemind-Prism components.
All AWS services are mocked using moto.
"""

import pytest
import json
import os
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime
from typing import Dict, Any

# AWS mocking
import boto3
from moto import mock_aws


# ========== PYTEST CONFIGURATION ==========

def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line("markers", "unit: Unit tests (no AWS required)")
    config.addinivalue_line("markers", "infrastructure: CDK infrastructure tests")
    config.addinivalue_line("markers", "agent: Agent-specific tests")
    config.addinivalue_line("markers", "mcp: MCP server tests")
    config.addinivalue_line("markers", "lambda: Lambda function tests")
    config.addinivalue_line("markers", "shared: Shared library tests")


# ========== AWS SERVICE MOCKS ==========

@pytest.fixture(autouse=True)
def mock_s3_client():
    """Mock S3 client with moto."""
    with mock_aws():
        client = boto3.client('s3', region_name='us-east-1')
        # Create test buckets
        client.create_bucket(Bucket='hivemind-uploads')
        client.create_bucket(Bucket='hivemind-artifacts')
        client.create_bucket(Bucket='hivemind-findings')
        client.create_bucket(Bucket='hivemind-kendra')
        client.create_bucket(Bucket='test-bucket')
        
        yield client


@pytest.fixture(autouse=True)
def mock_dynamodb_client():
    """Mock DynamoDB client with moto."""
    with mock_aws():
        client = boto3.client('dynamodb', region_name='us-east-1')
        # Create test tables
        client.create_table(
            TableName='HivemindFindings',
            KeySchema=[
                {'AttributeName': 'finding_id', 'KeyType': 'HASH'},
                {'AttributeName': 'timestamp', 'KeyType': 'RANGE'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'finding_id', 'AttributeType': 'S'},
                {'AttributeName': 'timestamp', 'AttributeType': 'N'},
                {'AttributeName': 'mission_id', 'AttributeType': 'S'}
            ],
            GlobalSecondaryIndexes=[
                {
                    'IndexName': 'mission_id-timestamp-index',
                    'KeySchema': [
                        {'AttributeName': 'mission_id', 'KeyType': 'HASH'},
                        {'AttributeName': 'timestamp', 'KeyType': 'RANGE'}
                    ],
                    'Projection': {'ProjectionType': 'ALL'}
                }
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        client.create_table(
            TableName='HivemindMissions',
            KeySchema=[
                {'AttributeName': 'mission_id', 'KeyType': 'HASH'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'mission_id', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        client.create_table(
            TableName='test-table',
            KeySchema=[
                {'AttributeName': 'mission_id', 'KeyType': 'HASH'},
                {'AttributeName': 'tool_timestamp', 'KeyType': 'RANGE'}
            ],
            AttributeDefinitions=[
                {'AttributeName': 'mission_id', 'AttributeType': 'S'},
                {'AttributeName': 'tool_timestamp', 'AttributeType': 'S'}
            ],
            BillingMode='PAY_PER_REQUEST'
        )
        yield client


@pytest.fixture
def mock_bedrock_client():
    """Mock Bedrock client for AI operations."""
    mock_client = Mock()
    
    # Default response for most agents
    def create_response(request_body=None):
        # Try to detect what kind of response is needed based on context
        default_response = {
            'criticality_tier': 1,
            'handles_pii': True,
            'handles_payment': False,
            'authentication_present': True,
            'primary_languages': ['Python', 'JavaScript'],
            'data_flows': [{'from': 'api', 'to': 'database', 'type': 'user_data'}],
            'reasoning': 'Test analysis based on code patterns',
            'confidence': 0.85,
            # For critic agent
            'action': 'CONFIRM',
            'revised_severity': 'HIGH',
            'rationale': 'Finding is valid',
            # For strategist
            'tools': [
                {'name': 'semgrep-mcp', 'task_definition': 'hivemind-semgrep-mcp', 'priority': 1},
                {'name': 'gitleaks-mcp', 'task_definition': 'hivemind-gitleaks-mcp', 'priority': 2},
                {'name': 'trivy-mcp', 'task_definition': 'hivemind-trivy-mcp', 'priority': 3}
            ],
            'parallel_execution': True,
            'estimated_duration_minutes': 10
        }
        
        mock_response_body = {
            'content': [{
                'type': 'text',
                'text': json.dumps(default_response)
            }],
            'stop_reason': 'end_turn',
            'usage': {
                'input_tokens': 100,
                'output_tokens': 50
            }
        }
        
        return {
            'body': Mock(read=lambda: json.dumps(mock_response_body).encode())
        }
    
    mock_client.invoke_model.side_effect = lambda **kwargs: create_response(kwargs.get('body'))
    
    yield mock_client


@pytest.fixture
def mock_kendra_client():
    """Mock Kendra client for RAG operations."""
    mock_client = Mock()
    
    # Mock retrieve method (actual method used in code)
    mock_client.retrieve.return_value = {
        'ResultItems': [
            {
                'Id': 'doc1',
                'DocumentTitle': 'Previous Scan Analysis',
                'Content': 'Similar vulnerability found in previous scan. Authentication patterns detected.',
                'DocumentURI': 's3://hivemind-kendra/doc1',
                'ScoreAttributes': {'ScoreConfidence': 'HIGH'},
                'DocumentAttributes': []
            },
            {
                'Id': 'doc2',
                'DocumentTitle': 'PII Detection Pattern',
                'Content': 'Previous scan identified PII handling in user management module.',
                'DocumentURI': 's3://hivemind-kendra/doc2',
                'ScoreAttributes': {'ScoreConfidence': 'MEDIUM'},
                'DocumentAttributes': []
            }
        ]
    }
    
    yield mock_client


@pytest.fixture(autouse=True)
def mock_redis_client():
    """Mock Redis client for agent coordination."""
    with patch('redis.Redis') as mock:
        mock_redis = Mock()
        # Mock Redis operations
        mock_redis.set.return_value = True
        mock_redis.get.return_value = json.dumps({'status': 'success'}).encode()
        mock_redis.delete.return_value = 1
        mock_redis.exists.return_value = True
        mock_redis.hset.return_value = True
        mock_redis.hget.return_value = json.dumps({'status': 'success'}).encode()
        mock_redis.sadd.return_value = 1
        mock_redis.srem.return_value = 1
        mock_redis.smembers.return_value = set()
        mock_redis.lrange.return_value = []  # Add lrange for archivist
        mock_redis.rpush.return_value = 1
        mock_redis.zadd.return_value = 1
        mock_redis.scan_iter.return_value = iter([])  # Add scan_iter for cleanup
        mock.return_value = mock_redis
        yield mock_redis


@pytest.fixture
def mock_stepfunctions_client():
    """Mock Step Functions client."""
    with mock_aws():
        client = boto3.client('stepfunctions', region_name='us-east-1')
        yield client


@pytest.fixture
def mock_ecs_client():
    """Mock ECS client for task execution."""
    with mock_aws():
        client = boto3.client('ecs', region_name='us-east-1')
        yield client


# ========== TEST DATA FIXTURES ==========

@pytest.fixture
def sample_scan_data():
    """Sample scan data for testing."""
    return {
        'scan_id': 'test-scan-123',
        'repository_url': 'https://github.com/test/repo',
        'timestamp': datetime.utcnow().isoformat(),
        'user': 'test-user'
    }


@pytest.fixture
def sample_context_manifest():
    """Sample context manifest from Archaeologist."""
    return {
        'scan_id': 'test-scan-123',
        'mission_id': 'test-scan-123',
        'service_name': 'test-service',
        'criticality_tier': 1,
        'handles_pii': True,
        'handles_payment': False,
        'authentication_present': True,
        'primary_languages': ['Python', 'JavaScript'],
        'file_count': 50,
        'total_lines': 5000,
        'key_files': ['src/app.py', 'src/config.py'],
        'dependencies': ['flask==2.0.0', 'requests==2.28.0'],
        'data_flows': [{'from': 'api', 'to': 'database', 'type': 'user_data'}],
        'confidence_score': 0.85,
        'research_artifacts_s3_key': 'research/test-scan-123/artifacts.json',
        'dependency_graph_summary': {},
        'call_graph_summary': {},
        'security_patterns_count': 2,
        'repository_structure': {
            'total_files': 50,
            'languages': ['Python', 'JavaScript'],
            'file_tree': {
                'src/': ['app.py', 'config.py'],
                'tests/': ['test_app.py']
            }
        },
        'code_patterns': {
            'secrets': 2,
            'sql_queries': 5,
            'api_endpoints': 10
        },
        'research_summary': {
            'total_functions': 100,
            'entry_points': ['main', 'api_handler'],
            'security_hotspots': 3
        }
    }


@pytest.fixture
def sample_tool_plan():
    """Sample tool plan from Strategist."""
    return {
        'scan_id': 'test-scan-123',
        'selected_tools': ['semgrep', 'gitleaks', 'trivy'],
        'execution_order': 'parallel',
        'rationale': {
            'semgrep': 'Code analysis for security patterns',
            'gitleaks': 'Secret detection',
            'trivy': 'Dependency vulnerabilities'
        }
    }


@pytest.fixture
def sample_tool_results():
    """Sample tool results from MCP servers."""
    return {
        'scan_id': 'test-scan-123',
        'tool_results': {
            'semgrep': {
                'findings': [
                    {
                        'rule_id': 'python.lang.security.injection.sql',
                        'severity': 'HIGH',
                        'message': 'SQL injection vulnerability',
                        'location': 'src/app.py:45'
                    }
                ],
                'execution_time': 12.5
            },
            'gitleaks': {
                'findings': [
                    {
                        'rule': 'aws-access-key',
                        'secret': 'AKIA...',
                        'file': 'config.py',
                        'line': 10
                    }
                ],
                'execution_time': 5.2
            },
            'trivy': {
                'findings': [
                    {
                        'vulnerability_id': 'CVE-2023-1234',
                        'package': 'flask',
                        'severity': 'CRITICAL',
                        'fixed_version': '2.0.1'
                    }
                ],
                'execution_time': 8.7
            }
        }
    }


@pytest.fixture
def sample_draft_findings():
    """Sample draft findings from Synthesizer."""
    return {
        'scan_id': 'test-scan-123',
        'findings': [
            {
                'finding_id': 'FIND-001',
                'title': 'SQL Injection in User Input',
                'severity': 'HIGH',
                'cvss_score': 7.5,
                'description': 'User input is not sanitized',
                'file_path': 'src/app.py',
                'line_numbers': [45],
                'affected_files': ['src/app.py'],
                'evidence': {
                    'tool': 'semgrep',
                    'rule': 'python.lang.security.injection.sql',
                    'location': 'line 45'
                },
                'evidence_digest': 'abc123',
                'tool_source': 'semgrep',
                'confidence_score': 0.85,
                'remediation': 'Use parameterized queries'
            },
            {
                'finding_id': 'FIND-002',
                'title': 'Hardcoded AWS Credentials',
                'severity': 'CRITICAL',
                'cvss_score': 9.0,
                'description': 'AWS access key found in source code',
                'file_path': 'config.py',
                'line_numbers': [10],
                'affected_files': ['config.py'],
                'evidence': {
                    'tool': 'gitleaks',
                    'rule': 'aws-access-key',
                    'location': 'line 10'
                },
                'evidence_digest': 'def456',
                'tool_source': 'gitleaks',
                'confidence_score': 0.95,
                'remediation': 'Use AWS Secrets Manager or environment variables'
            }
        ]
    }


@pytest.fixture
def sample_final_findings():
    """Sample final findings after Critic review."""
    return {
        'scan_id': 'test-scan-123',
        'findings': [
            {
                'finding_id': 'FIND-001',
                'title': 'SQL Injection in User Input',
                'severity': 'HIGH',
                'cvss_score': 7.5,
                'description': 'User input is not sanitized before SQL query',
                'file_path': 'src/app.py',
                'line_numbers': [45],
                'evidence_digest': 'abc123',
                'tool_source': 'semgrep',
                'confidence_score': 0.9,
                'status': 'validated',
                'confidence': 'HIGH',
                'false_positive_likelihood': 'LOW'
            },
            {
                'finding_id': 'FIND-002',
                'title': 'Hardcoded AWS Credentials',
                'severity': 'CRITICAL',
                'cvss_score': 9.0,
                'description': 'AWS access key found in source code',
                'file_path': 'config.py',
                'line_numbers': [10],
                'evidence_digest': 'def456',
                'tool_source': 'gitleaks',
                'confidence_score': 0.95,
                'status': 'validated',
                'confidence': 'HIGH',
                'false_positive_likelihood': 'LOW'
            }
        ],
        'negotiation_rounds': 2,
        'consensus_reached': True
    }


@pytest.fixture
def sample_security_wiki():
    """Sample security wiki structure."""
    return {
        'scan_id': 'test-scan-123',
        'generated_at': datetime.utcnow().isoformat(),
        'sections': {
            'executive_summary': 'Found 2 critical vulnerabilities',
            'security_posture': 'MEDIUM',
            'findings_by_severity': {
                'CRITICAL': 1,
                'HIGH': 1,
                'MEDIUM': 0,
                'LOW': 0
            },
            'remediation_priority': [
                'Fix hardcoded credentials',
                'Sanitize SQL inputs'
            ]
        }
    }


# ========== ENVIRONMENT FIXTURES ==========

@pytest.fixture
def mock_environment():
    """Mock environment variables."""
    env_vars = {
        'UPLOAD_BUCKET': 'hivemind-uploads',
        'ARTIFACT_BUCKET': 'hivemind-artifacts',
        'FINDINGS_BUCKET': 'hivemind-findings',
        'FINDINGS_TABLE': 'HivemindFindings',
        'REDIS_ENDPOINT': 'localhost:6379',
        'KENDRA_INDEX_ID': '12345678-1234-1234-1234-123456789012',
        'BEDROCK_MODEL_ID': 'anthropic.claude-sonnet-4-20250514-v1:0',
        'S3_ARTIFACTS_BUCKET': 'test-bucket',
        'DYNAMODB_TOOL_RESULTS_TABLE': 'test-table',
        'MISSION_ID': 'test-scan-123',
        'AWS_REGION': 'us-east-1'
    }
    
    with patch.dict(os.environ, env_vars):
        yield env_vars


# ========== HELPER FIXTURES ==========

@pytest.fixture
def create_s3_object(mock_s3_client):
    """Helper to create S3 objects in tests."""
    def _create_object(bucket: str, key: str, content):
        # Encode content to bytes
        if isinstance(content, dict):
            body = json.dumps(content).encode('utf-8')
        elif isinstance(content, bytes):
            body = content
        else:
            body = str(content).encode('utf-8')
        
        # Put object directly (bucket should exist from fixture)
        mock_s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body
        )
    return _create_object


@pytest.fixture
def get_s3_object(mock_s3_client):
    """Helper to get S3 objects in tests."""
    def _get_object(bucket: str, key: str) -> Dict[str, Any]:
        response = mock_s3_client.get_object(Bucket=bucket, Key=key)
        return json.loads(response['Body'].read().decode('utf-8'))
    return _get_object


@pytest.fixture
def mock_subprocess():
    """Mock subprocess for CLI tool testing."""
    with patch('subprocess.run') as mock:
        mock.return_value = Mock(
            returncode=0,
            stdout='{"findings": []}',
            stderr=''
        )
        yield mock


@pytest.fixture
def mock_deep_researcher():
    """Mock DeepCodeResearcher for testing."""
    from unittest.mock import MagicMock
    mock_researcher = MagicMock()
    
    # Mock file catalog
    mock_researcher.file_catalog = {
        'src/app.py': Mock(path='src/app.py', lines=150, complexity=8),
        'src/config.py': Mock(path='src/config.py', lines=50, complexity=3),
        'tests/test_app.py': Mock(path='tests/test_app.py', lines=200, complexity=5)
    }
    
    # Use return_value for simpler mocking
    mock_researcher.catalog_repository.return_value = {
        'total_files': 3,
        'total_lines': 400,
        'languages': {'Python': 3}
    }
    
    mock_researcher.build_dependency_graph.return_value = {
        'src/app.py': ['src/config.py'],
        'tests/test_app.py': ['src/app.py']
    }
    
    mock_researcher.build_call_graph.return_value = {
        'main::app': ['handler::process'],
        'handler::process': ['utils::validate']
    }
    
    # Mock detect_security_patterns - return Mock objects with attributes
    pattern1 = Mock()
    pattern1.type = 'sql_injection'
    pattern1.file = 'src/app.py'
    pattern1.line = 45
    pattern1.severity = 'HIGH'
    
    pattern2 = Mock()
    pattern2.type = 'hardcoded_secret'
    pattern2.file = 'src/config.py'
    pattern2.line = 10
    pattern2.severity = 'CRITICAL'
    
    mock_researcher.detect_security_patterns.return_value = [pattern1, pattern2]
    
    mock_researcher.synthesize_research.return_value = {
        'catalog_summary': {
            'total_files': 3,
            'total_lines': 400,
            'languages': {'Python': 3},
            'avg_complexity': 5.3
        },
        'dependency_insights': {
            'most_imported_files': [
                ('src/config.py', 2),
                ('src/app.py', 1)
            ],
            'circular_dependencies': [],
            'isolated_files': [],
            'dead_code_candidates': []
        },
        'call_graph_insights': {
            'entry_points': ['main::app', 'cli::main'],
            'most_called_functions': [
                ('handler::process', 5),
                ('utils::validate', 3)
            ],
            'dead_code_candidates': []
        },
        'security_insights': {
            'high_risk_files': [
                ('src/app.py', 1),
                ('src/config.py', 1)
            ],
            'pattern_summary': {
                'sql_injection': 1,
                'hardcoded_secret': 1
            },
            'dead_code_candidates': []
        },
        'kendra_context': {
            'authentication patterns': [
                {'title': 'JWT Authentication Pattern', 'excerpt': 'Previous scans show JWT authentication pattern with secure token handling'}
            ],
            'PII handling': [
                {'title': 'User Data Encryption', 'excerpt': 'User data is encrypted at rest using AES-256'}
            ],
            'payment processing': [
                {'title': 'Payment Processing', 'excerpt': 'No payment processing detected in this service'}
            ],
            'service criticality': [
                {'title': 'High Criticality Service', 'excerpt': 'High criticality - user-facing service with sensitive data'}
            ],
            'security vulnerabilities': [
                {'title': 'SQL Injection Patterns', 'excerpt': 'Common SQL injection patterns found in similar codebases'}
            ]
        }
    }
    
    mock_researcher.export_research_artifacts.return_value = 'research/test-scan-123/artifacts.json'
    
    yield mock_researcher


@pytest.fixture
def mock_cognitive_kernel():
    """Mock CognitiveKernel for testing."""
    mock_kernel = Mock()
    
    # Create a response factory that returns appropriate structure based on context
    def create_response(*args, **kwargs):
        # Create a simple object with content attribute
        class MockResponse:
            def __init__(self, content):
                self.content = content
        
        # Check if this looks like a synthesizer call (expects list)
        user_prompt = kwargs.get('user_prompt', '')
        if 'Draft findings in JSON array' in user_prompt or 'Tool Results:' in user_prompt:
            # Synthesizer expects a list of findings
            content = json.dumps([
                {
                    "title": "SQL Injection Vulnerability",
                    "severity": "HIGH",
                    "description": "User input not sanitized",
                    "file_path": "src/app.py",
                    "line_numbers": [45],
                    "tool_source": "semgrep",
                    "confidence": 0.85
                }
            ])
        else:
            # Archaeologist and others expect a dict
            content = json.dumps({
                "criticality_tier": 1,
                "handles_pii": True,
                "handles_payment": False,
                "authentication_present": True,
                "primary_languages": ["Python", "JavaScript"],
                "data_flows": [{"from": "api", "to": "database", "type": "user_data"}],
                "reasoning": "Test analysis based on code patterns",
                "confidence": 0.85
            })
        
        return MockResponse(content)
    
    mock_kernel.invoke_claude.side_effect = create_response
    
    # Mock retrieve_from_kendra to return KendraContext structure
    mock_kendra_context = Mock()
    mock_kendra_context.documents = [
        {
            'title': 'Previous finding',
            'content': 'Similar pattern detected',
            'excerpt': 'Similar pattern detected in previous scans',
            'score': 0.9
        },
        {
            'title': 'Best practices',
            'content': 'Security recommendations',
            'excerpt': 'Follow security best practices for input validation',
            'score': 0.85
        }
    ]
    mock_kendra_context.query = "test query"
    mock_kendra_context.total_results = 2
    mock_kernel.retrieve_from_kendra.return_value = mock_kendra_context
    
    yield mock_kernel


# ========== PYTEST HOOKS ==========

def pytest_collection_modifyitems(config, items):
    """Automatically mark tests based on their location."""
    for item in items:
        # Auto-mark based on test file location
        if "unit/agents" in str(item.fspath):
            item.add_marker(pytest.mark.agent)
        elif "unit/mcp_servers" in str(item.fspath):
            item.add_marker(pytest.mark.mcp)
        elif "unit/lambdas" in str(item.fspath):
            item.add_marker(pytest.mark.lambda_func)
        elif "unit/shared" in str(item.fspath):
            item.add_marker(pytest.mark.shared)
        elif "infrastructure" in str(item.fspath):
            item.add_marker(pytest.mark.infrastructure)
        
        # All tests are unit tests unless otherwise marked
        if not any(mark.name in ['infrastructure'] for mark in item.iter_markers()):
            item.add_marker(pytest.mark.unit)