"""
Unit Tests for Trivy MCP Server
================================

Tests Trivy MCP tool implementation with MCP protocol.
"""

import pytest
import json
import asyncio
from unittest.mock import Mock, patch, AsyncMock, mock_open
from pathlib import Path


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
        assert server.mission_id == mock_environment['MISSION_ID']
    
    @pytest.mark.asyncio
    async def test_scan_tool_invocation(self, mock_subprocess, mock_environment):
        """Test scan tool execution via MCP protocol."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        
        # Mock trivy subprocess
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('builtins.open', mock_open(read_data=json.dumps({'Results': []}))):
                    with patch.object(server, '_store_results', new=AsyncMock(return_value={
                        's3_uri': 's3://bucket/key',
                        'digest': 'sha256:abc123',
                        'timestamp': 12345
                    })):
                        result = await server._execute_fs_scan({
                            'source_path': '/tmp/test',
                            'scan_type': 'vuln',
                            'severity': 'CRITICAL,HIGH',
                            'timeout': 60
                        })
        
        assert result['success'] == True
        assert result['tool'] == 'trivy'
    
    @pytest.mark.asyncio
    async def test_result_parsing(self, mock_environment):
        """Test Trivy JSON result parsing."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        
        trivy_output = {
            'Results': [
                {
                    'Target': 'package.json',
                    'Vulnerabilities': [
                        {
                            'VulnerabilityID': 'CVE-2021-44228',
                            'PkgName': 'log4j',
                            'Severity': 'CRITICAL',
                            'Title': 'Log4Shell vulnerability'
                        }
                    ]
                }
            ]
        }
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch.object(server, '_get_trivy_version', return_value='0.48.0'):
                    with patch('builtins.open', mock_open(read_data=json.dumps(trivy_output))):
                        result = await server._run_trivy_fs(
                            Path('/tmp/test'),
                            'vuln',
                            'CRITICAL,HIGH',
                            300
                        )
        
        assert result['tool'] == 'trivy'
        assert len(result['results']) == 1
        assert result['results'][0]['vulnerability_id'] == 'CVE-2021-44228'
    
    @pytest.mark.asyncio
    async def test_s3_upload(self, mock_environment):
        """Test result upload to S3."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        
        results = {'tool': 'trivy', 'results': [{'vulnerability_id': 'CVE-2021-44228', 'severity': 'CRITICAL'}]}
        
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
            
            # Mock S3 client
            mock_put = Mock()
            server.s3_client.put_object = mock_put
            
            # Mock DynamoDB client
            mock_dynamo = Mock()
            server.dynamodb_client.put_item = mock_dynamo
            
            storage_info = await server._store_results(results, 'fs_scan')
        
        assert 's3_uri' in storage_info
        assert 'digest' in storage_info
        assert storage_info['digest'].startswith('sha256:')
    
    @pytest.mark.asyncio
    async def test_error_handling_invalid_path(self, mock_environment):
        """Test error handling for invalid source path."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
            
            with patch('asyncio.create_subprocess_exec', side_effect=FileNotFoundError("Path not found")):
                with pytest.raises(FileNotFoundError):
                    await server._run_trivy_fs(
                        Path('/nonexistent'),
                        ['vuln'],
                        'CRITICAL',
                        300
                    )
    
    @pytest.mark.asyncio
    async def test_error_handling_trivy_failure(self, mock_environment):
        """Test error handling for Trivy execution failure."""
        from src.mcp_servers.trivy_mcp.server import TrivyMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 2  # Error code (not 0 or 1)
        mock_process.communicate = AsyncMock(return_value=(
            b'',
            b'Trivy error'
        ))
        
        with patch.dict('os.environ', mock_environment):
            server = TrivyMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with pytest.raises(Exception, match="Trivy failed"):
                    await server._run_trivy_fs(
                        Path('/tmp/test'),
                        'vuln',
                        'CRITICAL',
                        300
                    )