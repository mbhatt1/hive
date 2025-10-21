"""
Unit Tests for Gitleaks MCP Server
===================================

Tests Gitleaks MCP tool implementation with MCP protocol.
"""

import pytest
import json
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from pathlib import Path


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
        assert server.mission_id == mock_environment['MISSION_ID']
    
    @pytest.mark.asyncio
    async def test_scan_tool_invocation(self, mock_subprocess, mock_environment):
        """Test scan tool execution via MCP protocol."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        
        # Mock gitleaks subprocess
        mock_process = AsyncMock()
        mock_process.returncode = 1  # Leaks found
        mock_process.communicate = AsyncMock(return_value=(
            json.dumps([]).encode(),
            b''
        ))
        
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch.object(server, '_store_results', new=AsyncMock(return_value={
                    's3_uri': 's3://bucket/key',
                    'digest': 'sha256:abc123',
                    'timestamp': 12345
                })):
                    result = await server._execute_gitleaks_scan({
                        'source_path': '/tmp/test',
                        'config_path': None,
                        'timeout': 60,
                        'no_git': False
                    })
        
        assert result['success'] == True
        assert result['tool'] == 'gitleaks'
    
    @pytest.mark.asyncio
    async def test_result_parsing(self, mock_environment):
        """Test Gitleaks JSON result parsing."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        from unittest.mock import mock_open
        
        gitleaks_output = [
            {
                'Description': 'AWS Access Key',
                'Secret': 'AKIAIOSFODNN7EXAMPLE',
                'File': 'config.py',
                'StartLine': 12,
                'RuleID': 'aws-access-key'
            }
        ]
        
        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch.object(server, '_get_gitleaks_version', return_value='8.18.0'):
                    # Mock file reading
                    with patch('builtins.open', mock_open(read_data=json.dumps(gitleaks_output))):
                        result = await server._run_gitleaks(Path('/tmp/test'), None, 300, False)
        
        assert result['tool'] == 'gitleaks'
        assert len(result['results']) == 1
        assert result['results'][0]['rule_id'] == 'aws-access-key'
    
    @pytest.mark.asyncio
    async def test_s3_upload(self, mock_environment):
        """Test result upload to S3."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        
        results = {'tool': 'gitleaks', 'results': [{'rule_id': 'test', 'severity': 'HIGH'}]}
        
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
            
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
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
            
            with patch('asyncio.create_subprocess_exec', side_effect=FileNotFoundError("Path not found")):
                with pytest.raises(FileNotFoundError):
                    await server._run_gitleaks(Path('/nonexistent'), None, 300, False)
    
    @pytest.mark.asyncio
    async def test_error_handling_gitleaks_failure(self, mock_environment):
        """Test error handling for Gitleaks execution failure."""
        from src.mcp_servers.gitleaks_mcp.server import GitleaksMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 2  # Error code
        mock_process.communicate = AsyncMock(return_value=(
            b'',
            b'Gitleaks error'
        ))
        
        with patch.dict('os.environ', mock_environment):
            server = GitleaksMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with pytest.raises(Exception, match="Gitleaks failed"):
                    await server._run_gitleaks(Path('/tmp/test'), None, 300, False)