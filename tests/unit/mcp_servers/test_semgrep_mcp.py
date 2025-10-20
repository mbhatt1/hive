"""
Unit Tests for Semgrep MCP Server
==================================

Tests Semgrep MCP tool implementation.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.mcp
@pytest.mark.unit
class TestSemgrepMCP:
    """Test suite for Semgrep MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        # Act
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
        
        # Assert
        assert server is not None
        assert hasattr(server, 'run')
    
    def test_scan_tool_invocation(
        self,
        mock_subprocess,
        mock_environment
    ):
        """Test scan tool execution."""
        # Arrange
        mock_subprocess.return_value = Mock(
            returncode=0,
            stdout=json.dumps({'results': []}),
            stderr=''
        )
        
        # Act
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', mock_subprocess):
                with patch.object(SemgrepMCPServer, '_download_source', return_value='/tmp/test-repo'):
                    with patch.object(SemgrepMCPServer, '_write_results'):
                        server = SemgrepMCPServer()
                        result = server.run()
        
        # Assert
        assert result == 0
    
    def test_result_parsing(self, mock_environment):
        """Test Semgrep JSON result parsing through _run_semgrep."""
        # Arrange
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        from pathlib import Path
        
        semgrep_output = {
            'results': [
                {
                    'check_id': 'python.lang.security.injection.sql',
                    'path': 'app.py',
                    'start': {'line': 45},
                    'end': {'line': 47},
                    'extra': {'severity': 'ERROR', 'message': 'SQL injection', 'lines': 'code here'}
                }
            ]
        }
        
        # Act
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = Mock(
                    returncode=1,
                    stdout=json.dumps(semgrep_output),
                    stderr=''
                )
                result = server._run_semgrep(Path('/tmp/test'))
        
        # Assert
        assert result['tool'] == 'semgrep'
        assert len(result['results']) == 1
        assert result['results'][0]['rule_id'] == 'python.lang.security.injection.sql'
    
    def test_s3_upload(
        self,
        mock_environment
    ):
        """Test result upload to S3 through _write_results."""
        # Arrange
        results = {'tool': 'semgrep', 'results': [{'rule_id': 'test', 'severity': 'HIGH'}]}
        
        # Act
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        with patch.dict('os.environ', mock_environment):
            # Server uses autouse fixtures from conftest for S3 and DynamoDB
            server = SemgrepMCPServer()
            # Just verify the method runs without error
            server._write_results(results)
        
        # The method should complete without raising exceptions
        assert True
    
    def test_error_handling_invalid_path(
        self,
        mock_environment
    ):
        """Test error handling for invalid repository path."""
        # Act & Assert
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        with patch.dict('os.environ', mock_environment):
            # Server uses autouse fixtures from conftest
            with patch.object(SemgrepMCPServer, '_download_source', side_effect=Exception("No files found")):
                server = SemgrepMCPServer()
                result = server.run()
                assert result == 1
    
    def test_error_handling_semgrep_failure(
        self,
        mock_subprocess,
        mock_environment
    ):
        """Test error handling when Semgrep fails."""
        # Arrange
        mock_subprocess.return_value = Mock(
            returncode=2,
            stdout='',
            stderr='Semgrep error'
        )
        
        # Act & Assert
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        from pathlib import Path
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', mock_subprocess):
                with patch.object(SemgrepMCPServer, '_download_source', return_value=Path('/tmp/test')):
                    with patch.object(SemgrepMCPServer, '_write_error'):
                        server = SemgrepMCPServer()
                        result = server.run()
                        assert result == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])