# MCP Integration Tests

This directory contains integration tests for the Model Context Protocol (MCP) implementation in Hivemind-Prism.

## Overview

These tests verify:
- MCP protocol compliance (JSON-RPC 2.0)
- Tool discovery and invocation
- Evidence chain verification
- End-to-end workflows
- Connection management
- Parallel tool execution

## Test Structure

```
tests/integration/
├── __init__.py
├── conftest.py              # Fixtures and test configuration
├── test_mcp_protocol.py     # Main integration tests
└── README.md                # This file
```

## Running Tests

### Run All Integration Tests

```bash
pytest tests/integration/ -v
```

### Run Specific Test Classes

```bash
# Test MCP protocol compliance
pytest tests/integration/test_mcp_protocol.py::TestMCPProtocol -v

# Test tool invocation
pytest tests/integration/test_mcp_protocol.py::TestMCPToolInvocation -v

# Test evidence chains
pytest tests/integration/test_mcp_protocol.py::TestMCPEvidenceChain -v

# Test end-to-end workflows
pytest tests/integration/test_mcp_protocol.py::TestEndToEndMCPWorkflow -v
```

### Run with Markers

```bash
# Run only integration tests
pytest -m integration -v

# Run tests requiring MCP servers
pytest -m mcp_required -v

# Skip slow tests
pytest -m "integration and not slow_integration" -v
```

## Prerequisites

### Required Dependencies

Install test dependencies:
```bash
pip install -r requirements-test.txt
```

### Environment Setup

Set required environment variables:
```bash
export MISSION_ID="test-mission-123"
export S3_ARTIFACTS_BUCKET="test-hivemind-artifacts"
export AWS_REGION="us-east-1"
export ENABLE_MCP_TOOLS="true"
```

### MCP Servers

Tests will automatically start MCP servers as child processes. Ensure:
- Python 3.11+ is installed
- All MCP server dependencies are installed
- MCP server scripts are executable

## Test Classes

### TestMCPProtocol
Tests basic MCP protocol compliance and server connections.

**Tests:**
- `test_semgrep_mcp_server_connection` - Connect to Semgrep server
- `test_gitleaks_mcp_server_connection` - Connect to Gitleaks server
- `test_trivy_mcp_server_connection` - Connect to Trivy server
- `test_mcp_tool_registry` - Test multi-server management

### TestMCPToolInvocation
Tests actual tool invocation and result handling.

**Tests:**
- `test_semgrep_scan_invocation` - Invoke Semgrep scan
- `test_mcp_error_handling` - Test error scenarios

### TestCognitiveKernelMCPIntegration
Tests Cognitive Kernel integration with MCP.

**Tests:**
- `test_list_mcp_tools_via_kernel` - List tools through kernel
- `test_invoke_mcp_tool_via_kernel` - Invoke tool through kernel
- `test_parallel_mcp_invocation` - Test parallel execution

### TestMCPEvidenceChain
Tests evidence chain verification logic.

**Tests:**
- `test_evidence_digest_format` - Verify SHA256 digest format
- `test_evidence_chain_verification` - Verify integrity checks

### TestMCPServerCompliance
Tests JSON-RPC 2.0 protocol compliance.

**Tests:**
- `test_server_initialization` - Test server startup
- `test_json_rpc_protocol` - Verify protocol format

### TestMCPConnectionManagement
Tests connection lifecycle management.

**Tests:**
- `test_connection_cleanup` - Test proper cleanup
- `test_registry_cleanup` - Test registry cleanup

### TestEndToEndMCPWorkflow
Tests complete end-to-end workflows.

**Tests:**
- `test_full_scan_workflow` - Complete scan workflow

## Test Fixtures

Available fixtures (defined in `conftest.py`):

- `test_mission_id` - Test mission identifier
- `test_s3_bucket` - Test S3 bucket name
- `test_env` - Complete test environment variables
- `test_code_directory` - Temporary directory with vulnerable code
- `sample_mcp_tool_result` - Sample tool result structure
- `mcp_server_configs` - MCP server configurations
- `mock_s3_artifacts` - Mock S3 directory structure
- `sample_finding` - Sample security finding
- `sample_evidence_chain` - Sample evidence chain with digest

## Expected Behavior

### Successful Test Run

```
tests/integration/test_mcp_protocol.py::TestMCPProtocol::test_semgrep_mcp_server_connection PASSED
tests/integration/test_mcp_protocol.py::TestMCPProtocol::test_gitleaks_mcp_server_connection PASSED
tests/integration/test_mcp_protocol.py::TestMCPProtocol::test_trivy_mcp_server_connection PASSED
...
```

### Common Issues

**Issue: MCP server not found**
```
FileNotFoundError: python src/mcp_servers/semgrep_mcp/server.py
```
**Solution:** Ensure you're running tests from project root

**Issue: Module import errors**
```
ModuleNotFoundError: No module named 'mcp'
```
**Solution:** Install MCP dependencies: `pip install mcp`

**Issue: Connection timeout**
```
TimeoutError: MCP server did not respond
```
**Solution:** Increase timeout or check server logs

## Debugging

### Enable Verbose Logging

```bash
pytest tests/integration/ -v -s --log-cli-level=DEBUG
```

### Run Single Test with Output

```bash
pytest tests/integration/test_mcp_protocol.py::TestMCPProtocol::test_semgrep_mcp_server_connection -v -s
```

### Inspect Test Artifacts

Test artifacts are created in temporary directories:
```bash
# Find temp directories
pytest tests/integration/ -v --basetemp=/tmp/pytest-hivemind
```

## Coverage

Generate coverage report:
```bash
pytest tests/integration/ --cov=src/mcp_servers --cov=src/shared/mcp_client --cov-report=html
```

View coverage:
```bash
open htmlcov/index.html
```

## Continuous Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run Integration Tests
  run: |
    export MISSION_ID="ci-test-${{ github.run_id }}"
    pytest tests/integration/ -v --junitxml=test-results/integration.xml
```

## Performance Benchmarks

Typical test execution times:
- Protocol tests: ~2-5 seconds
- Tool invocation: ~10-30 seconds (depends on scan)
- End-to-end workflow: ~30-60 seconds

## Contributing

When adding new integration tests:

1. Follow existing test patterns
2. Use provided fixtures
3. Add appropriate markers (`@pytest.mark.integration`)
4. Document expected behavior
5. Clean up resources in teardown
6. Update this README

## Related Documentation

- [MCP Implementation Guide](../../MCP_IMPLEMENTATION_GUIDE.md)
- [MCP Implementation Status](../../MCP_IMPLEMENTATION_STATUS.md)
- [Testing Guide](../../TESTING.md)
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)