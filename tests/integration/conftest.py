"""
Integration test configuration and fixtures.
Provides common setup for MCP protocol testing.
"""

import pytest
import asyncio
import tempfile
from pathlib import Path


@pytest.fixture(scope="session")
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def test_mission_id():
    """Provide a test mission ID."""
    return "test-mission-123"


@pytest.fixture
def test_s3_bucket():
    """Provide a test S3 bucket name."""
    return "test-hivemind-artifacts"


@pytest.fixture
def test_env(test_mission_id, test_s3_bucket):
    """Provide test environment variables."""
    return {
        'MISSION_ID': test_mission_id,
        'S3_ARTIFACTS_BUCKET': test_s3_bucket,
        'AWS_REGION': 'us-east-1',
        'ENABLE_MCP_TOOLS': 'true'
    }


@pytest.fixture
def test_code_directory(tmp_path):
    """Create a temporary test code directory with sample files."""
    test_dir = tmp_path / "test-code"
    test_dir.mkdir()
    
    # Python file with intentional security issues
    (test_dir / "app.py").write_text("""
import os

# Hardcoded credentials (should be detected)
API_KEY = "sk-1234567890abcdef"
DB_PASSWORD = "admin123"

def unsafe_eval(user_input):
    # Code injection vulnerability
    return eval(user_input)

def sql_query(user_id):
    # SQL injection vulnerability
    query = f"SELECT * FROM users WHERE id = {user_id}"
    return query

def command_injection(filename):
    # Command injection
    os.system(f"cat {filename}")
""")
    
    # JavaScript file with security issues
    (test_dir / "app.js").write_text("""
// Hardcoded credentials
const API_SECRET = "abc123xyz456";
const DB_CONN = "mongodb://admin:password@localhost";

// XSS vulnerability
function renderHTML(userInput) {
    document.getElementById("output").innerHTML = userInput;
}

// Prototype pollution
function merge(target, source) {
    for (let key in source) {
        target[key] = source[key];
    }
    return target;
}
""")
    
    # Requirements file with known vulnerabilities
    (test_dir / "requirements.txt").write_text("""
flask==0.12.0
requests==2.6.0
pyyaml==3.12
""")
    
    # Dockerfile with security issues
    (test_dir / "Dockerfile").write_text("""
FROM ubuntu:latest

# Running as root (security issue)
USER root

# Hardcoded secrets
ENV API_KEY="secret123"
ENV DB_PASSWORD="admin"

# Latest tag (not reproducible)
RUN apt-get update && apt-get install -y curl

COPY . /app
WORKDIR /app

CMD ["python", "app.py"]
""")
    
    return test_dir


@pytest.fixture
def sample_mcp_tool_result():
    """Provide a sample MCP tool result for testing."""
    return {
        'success': True,
        'server': 'semgrep-mcp',
        'tool': 'semgrep_scan',
        'content': [
            {
                'type': 'text',
                'text': 'Scan completed successfully'
            },
            {
                'type': 'resource',
                'resource': {
                    'uri': 's3://test-bucket/results.json',
                    'mimeType': 'application/json',
                    'metadata': {
                        'digest': 'sha256:abc123...'
                    }
                }
            }
        ]
    }


@pytest.fixture
def mcp_server_configs():
    """Provide MCP server configuration for testing."""
    return {
        'semgrep-mcp': {
            'command': ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            'args': []
        },
        'gitleaks-mcp': {
            'command': ['python', 'src/mcp_servers/gitleaks_mcp/server.py'],
            'args': []
        },
        'trivy-mcp': {
            'command': ['python', 'src/mcp_servers/trivy_mcp/server.py'],
            'args': []
        },
        'scoutsuite-mcp': {
            'command': ['python', 'src/mcp_servers/scoutsuite_mcp/server.py'],
            'args': []
        },
        'pacu-mcp': {
            'command': ['python', 'src/mcp_servers/pacu_mcp/server.py'],
            'args': []
        }
    }


@pytest.fixture(autouse=True)
def cleanup_mcp_connections():
    """Automatically cleanup MCP connections after each test."""
    yield
    # Cleanup happens in test teardown
    # MCP clients use async context managers for proper cleanup


@pytest.fixture
def mock_s3_artifacts(tmp_path):
    """Create mock S3 artifact directory structure."""
    artifacts_dir = tmp_path / "s3-artifacts"
    artifacts_dir.mkdir()
    
    # Create directory structure
    (artifacts_dir / "findings").mkdir()
    (artifacts_dir / "raw-results").mkdir()
    (artifacts_dir / "digests").mkdir()
    
    return artifacts_dir


@pytest.fixture
def sample_finding():
    """Provide a sample security finding for testing."""
    return {
        'id': 'FINDING-001',
        'severity': 'HIGH',
        'title': 'Hardcoded API Key',
        'description': 'API key found in source code',
        'file': 'app.py',
        'line': 5,
        'code_snippet': 'API_KEY = "sk-1234567890abcdef"',
        'cwe': 'CWE-798',
        'owasp': 'A02:2021',
        'references': [
            'https://cwe.mitre.org/data/definitions/798.html'
        ]
    }


@pytest.fixture
def sample_evidence_chain():
    """Provide a sample evidence chain for testing."""
    import hashlib
    import json
    
    data = {'findings': ['test']}
    content = json.dumps(data, sort_keys=True)
    digest = f"sha256:{hashlib.sha256(content.encode()).hexdigest()}"
    
    return {
        'content': content,
        'digest': digest,
        'timestamp': '2025-01-20T19:00:00Z',
        'source': 'semgrep-mcp'
    }


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom settings."""
    config.addinivalue_line(
        "markers", "integration: Integration tests requiring MCP servers"
    )
    config.addinivalue_line(
        "markers", "mcp_required: Tests that require MCP servers to be running"
    )
    config.addinivalue_line(
        "markers", "slow_integration: Slow integration tests"
    )