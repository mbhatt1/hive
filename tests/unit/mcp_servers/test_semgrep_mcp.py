"""
Unit Tests for Semgrep MCP Server
==================================

Tests Semgrep MCP tool implementation with MCP protocol.
"""

import pytest
import json
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from pathlib import Path


@pytest.mark.mcp
@pytest.mark.unit
class TestSemgrepMCP:
    """Test suite for Semgrep MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
        
        assert server is not None
        assert hasattr(server, 'run')
        assert server.mission_id == mock_environment['MISSION_ID']
    
    @pytest.mark.asyncio
    async def test_scan_tool_invocation(self, mock_subprocess, mock_environment):
        """Test scan tool execution via MCP protocol."""
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        
        # Mock semgrep subprocess
        mock_process = AsyncMock()
        mock_process.returncode = 1  # Findings found
        mock_process.communicate = AsyncMock(return_value=(
            json.dumps({'results': []}).encode(),
            b''
        ))
        
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch.object(server, '_store_results', new=AsyncMock(return_value={
                    's3_uri': 's3://bucket/key',
                    'digest': 'sha256:abc123',
                    'timestamp': 12345
                })):
                    result = await server._execute_semgrep_scan({
                        'source_path': '/tmp/test',
                        'config': 'auto',
                        'timeout': 60
                    })
        
        assert result['success'] == True
        assert result['tool'] == 'semgrep'
    
    @pytest.mark.asyncio
    async def test_result_parsing(self, mock_environment):
        """Test Semgrep JSON result parsing."""
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        
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
        
        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate = AsyncMock(return_value=(
            json.dumps(semgrep_output).encode(),
            b''
        ))
        
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch.object(server, '_get_semgrep_version', return_value='1.0.0'):
                    result = await server._run_semgrep(Path('/tmp/test'), 'auto', 300)
        
        assert result['tool'] == 'semgrep'
        assert len(result['results']) == 1
        assert result['results'][0]['rule_id'] == 'python.lang.security.injection.sql'
    
    @pytest.mark.asyncio
    async def test_s3_upload(self, mock_environment):
        """Test result upload to S3."""
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        
        results = {'tool': 'semgrep', 'results': [{'rule_id': 'test', 'severity': 'HIGH'}]}
        
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
            
            # Mock S3 client
            mock_put = Mock()
            server.s3_client.put_object = mock_put
            
            # Mock DynamoDB client
            mock_dynamo = Mock()
            server.dynamodb_client.put_item = mock_dynamo
            
            storage_info = await server._store_results(results)
        
        assert 's3_uri' in storage_info
        assert 'digest' in storage_info
        assert storage_info['digest'].startswith('sha256:')
    
    @pytest.mark.asyncio
    async def test_error_handling_invalid_path(self, mock_environment):
        """Test error handling for invalid source path."""
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
            
            with patch('asyncio.create_subprocess_exec', side_effect=FileNotFoundError("Path not found")):
                with pytest.raises(FileNotFoundError):
                    await server._run_semgrep(Path('/nonexistent'), 'auto', 300)
    
    @pytest.mark.asyncio
    async def test_error_handling_semgrep_failure(self, mock_environment):
        """Test error handling for Semgrep execution failure."""
        from src.mcp_servers.semgrep_mcp.server import SemgrepMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 2  # Error code
        mock_process.communicate = AsyncMock(return_value=(
            b'',
            b'Semgrep error'
        ))
        
        with patch.dict('os.environ', mock_environment):
            server = SemgrepMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with pytest.raises(Exception, match="Semgrep failed"):
                    await server._run_semgrep(Path('/tmp/test'), 'auto', 300)