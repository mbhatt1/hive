"""
Unit Tests for Gitleaks MCP Server
===================================

Tests Gitleaks MCP secret scanning implementation.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.mcp
@pytest.mark.unit
class TestGitleaksMCP:
    """Test suite for Gitleaks MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
        
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
            stdout=json.dumps([]),
            stderr=''
        )
        
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', mock_subprocess):
                with patch.object(GitleaksMCPServer, '_download_source', return_value='/tmp/test-repo'):
                    with patch.object(GitleaksMCPServer, '_write_results'):
                        server = GitleaksMCPServer()
                        result = server.run()
        
        assert result == 0
    
    def test_result_parsing(self, mock_environment):
        """Test Gitleaks JSON result parsing through _run_gitleaks."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        from pathlib import Path
        
        gitleaks_json = [
            {
                'RuleID': 'aws-access-key',
                'Description': 'AWS Access Key',
                'File': 'config.py',
                'StartLine': 10,
                'Match': 'AKIA...',
                'Commit': 'abc123'
            }
        ]
        
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = Mock(returncode=1, stdout='', stderr='')
                with patch('builtins.open', create=True) as mock_open:
                    mock_open.return_value.__enter__.return_value.read.return_value = json.dumps(gitleaks_json)
                    with patch('json.load', return_value=gitleaks_json):
                        result = server._run_gitleaks(Path('/tmp/test'))
        
        assert result['tool'] == 'gitleaks'
        assert len(result['results']) == 1
        assert result['results'][0]['rule_id'] == 'aws-access-key'
    
    def test_s3_upload(
        self,
        mock_environment
    ):
        """Test result upload to S3 through _write_results."""
        results = {'tool': 'gitleaks', 'results': [{'rule_id': 'test', 'secret_type': 'test'}]}
        
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        with patch.dict('os.environ', mock_environment):
            # Server uses autouse fixtures from conftest for S3 and DynamoDB
            server = GitleaksMCPServer()
            # Just verify the method runs without error
            server._write_results(results)
            
        # The method should complete without raising exceptions
        assert True
    
    def test_error_handling_invalid_path(self, mock_environment):
        """Test error handling for invalid repository path."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        with patch.dict('os.environ', mock_environment):
            # Server uses autouse fixtures from conftest
            with patch.object(GitleaksMCPServer, '_download_source', side_effect=Exception("No files found")):
                server = GitleaksMCPServer()
                result = server.run()
                assert result == 1
    
    def test_error_handling_gitleaks_failure(
        self,
        mock_subprocess,
        mock_environment
    ):
        """Test error handling when Gitleaks fails."""
        mock_subprocess.return_value = Mock(
            returncode=2,
            stdout='',
            stderr='Gitleaks error'
        )
        
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        from pathlib import Path
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', mock_subprocess):
                with patch.object(GitleaksMCPServer, '_download_source', return_value=Path('/tmp/test')):
                    with patch.object(GitleaksMCPServer, '_write_error'):
                        server = GitleaksMCPServer()
                        result = server.run()
                        assert result == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])