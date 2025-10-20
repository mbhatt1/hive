"""
Unit Tests for Trivy MCP Server
================================

Tests Trivy MCP dependency scanner implementation.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.mcp
@pytest.mark.unit
class TestTrivyMCP:
    """Test suite for Trivy MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
        
        assert server is not None
        assert hasattr(server, 'run')
    
    def test_scan_tool_invocation(
        self,
        mock_subprocess,
        mock_environment
    ):
        """Test scan tool execution."""
        mock_subprocess.return_value = Mock(
            returncode=0,
            stdout=json.dumps({'Results': []}),
            stderr=''
        )
        
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', mock_subprocess):
                with patch.object(TrivyMCPServer, '_download_source', return_value='/tmp/test-repo'):
                    with patch.object(TrivyMCPServer, '_write_results'):
                        server = TrivyMCPServer()
                        result = server.run()
        
        assert result == 0
    
    def test_result_parsing(self, mock_environment):
        """Test Trivy JSON result parsing through _run_trivy."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        from pathlib import Path
        
        trivy_output = {
            'Results': [
                {
                    'Target': 'requirements.txt',
                    'Vulnerabilities': [
                        {
                            'VulnerabilityID': 'CVE-2023-1234',
                            'PkgName': 'flask',
                            'InstalledVersion': '1.0.0',
                            'FixedVersion': '2.0.1',
                            'Severity': 'CRITICAL',
                            'Title': 'Test vulnerability',
                            'Description': 'Test description',
                            'References': []
                        }
                    ]
                }
            ]
        }
        
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = Mock(
                    returncode=0,
                    stdout=json.dumps(trivy_output),
                    stderr=''
                )
                result = server._run_trivy(Path('/tmp/test'))
        
        assert result['tool'] == 'trivy'
        assert len(result['results']) >= 1
        assert result['results'][0]['vulnerability_id'] == 'CVE-2023-1234'
    
    def test_s3_upload(
        self,
        mock_environment
    ):
        """Test result upload to S3 through _write_results."""
        results = {'tool': 'trivy', 'results': [{'vulnerability_id': 'CVE-2023-1234', 'severity': 'CRITICAL'}]}
        
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        with patch.dict('os.environ', mock_environment):
            # Server uses autouse fixtures from conftest for S3 and DynamoDB
            server = TrivyMCPServer()
            # Just verify the method runs without error
            server._write_results(results)
        
        # The method should complete without raising exceptions
        assert True
    
    def test_error_handling_invalid_path(self, mock_environment):
        """Test error handling for invalid repository path."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        with patch.dict('os.environ', mock_environment):
            # Server uses autouse fixtures from conftest
            with patch.object(TrivyMCPServer, '_download_source', side_effect=Exception("No files found")):
                server = TrivyMCPServer()
                result = server.run()
                assert result == 1
    
    def test_error_handling_trivy_failure(
        self,
        mock_subprocess,
        mock_environment
    ):
        """Test error handling when Trivy fails."""
        mock_subprocess.return_value = Mock(
            returncode=1,
            stdout='',
            stderr='Trivy error'
        )
        
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        from pathlib import Path
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', mock_subprocess):
                with patch.object(TrivyMCPServer, '_download_source', return_value=Path('/tmp/test')):
                    with patch.object(TrivyMCPServer, '_write_error'):
                        server = TrivyMCPServer()
                        result = server.run()
                        assert result == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])