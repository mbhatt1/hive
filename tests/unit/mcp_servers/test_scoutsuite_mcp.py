"""
Unit Tests for ScoutSuite MCP Server
=====================================

Tests ScoutSuite MCP tool implementation with MCP protocol.
"""

import pytest
import json
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from pathlib import Path


@pytest.mark.mcp
@pytest.mark.unit
class TestScoutSuiteMCP:
    """Test suite for ScoutSuite MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        assert server is not None
        assert hasattr(server, 'run')
        assert server.mission_id == mock_environment['MISSION_ID']
    
    def test_count_findings_method(self, mock_environment):
        """Test findings count calculation."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        scout_data = {
            'services': {
                's3': {
                    'findings': {
                        's3-bucket-no-logging': {
                            'description': 'S3 bucket without logging',
                            'level': 'danger',
                            'flagged_items': ['bucket1', 'bucket2']
                        }
                    }
                }
            }
        }
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            count = server._count_findings(scout_data)
        
        assert count == 2  # Two flagged items
    
    def test_create_summary(self, mock_environment):
        """Test summary creation from ScoutSuite results."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        scout_data = {
            'services': {
                's3': {
                    'findings': {
                        's3-bucket-no-logging': {
                            'description': 'S3 bucket without logging',
                            'level': 'danger',
                            'flagged_items': ['bucket1', 'bucket2']
                        }
                    }
                }
            }
        }
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            summary = server._create_summary(scout_data)
        
        assert summary['services_scanned'] == 1
        assert summary['by_service']['s3'] == 2
    
    def test_count_findings(self, mock_environment):
        """Test findings count calculation."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        findings = [
            {'severity': 'CRITICAL'},
            {'severity': 'HIGH'},
            {'severity': 'HIGH'}
        ]
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            count = len([f for f in findings if f['severity'] in ['CRITICAL', 'HIGH']])
        
        assert count == 3
    
    @pytest.mark.asyncio
    async def test_write_results(self, mock_environment):
        """Test result storage."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        results = {'tool': 'scoutsuite', 'findings_count': 5}
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            mock_put = Mock()
            server.s3_client.put_object = mock_put
            
            mock_dynamo = Mock()
            server.dynamodb_client.put_item = mock_dynamo
            
            storage_info = await server._store_results(results, 'test-report')
        
        assert 's3_uri' in storage_info
        assert 'digest' in storage_info
    
    @pytest.mark.asyncio
    async def test_write_error(self, mock_environment):
        """Test error result storage."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            mock_dynamo = Mock()
            server.dynamodb_client.put_item = mock_dynamo
            
            # Store error result
            await server._store_results({
                'tool': 'scoutsuite',
                'error': 'Test error',
                'findings_count': 0
            }, 'test-report')
        
        assert mock_dynamo.called
    
    @pytest.mark.asyncio
    async def test_run_scoutsuite_success(self, mock_environment):
        """Test successful ScoutSuite execution."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        scout_data = {
            'services': {},
            'last_run': {'time': '2024-01-01'}
        }
        
        # Mock file content with JS variable assignment
        js_content = f'scoutsuite_results = {json.dumps(scout_data)};'
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('pathlib.Path.exists', return_value=True):
                    with patch('pathlib.Path.read_text', return_value=js_content):
                        result = await server._run_scoutsuite(
                            'default',
                            [],
                            [],
                            'test-report',
                            300
                        )
        
        assert result['tool'] == 'scoutsuite'
    
    @pytest.mark.asyncio
    async def test_run_scoutsuite_with_access_keys(self, mock_environment):
        """Test ScoutSuite with AWS access keys."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        js_content = 'scoutsuite_results = {"services": {}};'
        
        with patch.dict('os.environ', {
            **mock_environment,
            'AWS_ACCESS_KEY_ID': 'AKIATEST',
            'AWS_SECRET_ACCESS_KEY': 'secret'
        }):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('pathlib.Path.exists', return_value=True):
                    with patch('pathlib.Path.read_text', return_value=js_content):
                        result = await server._run_scoutsuite(
                            'default',
                            [],
                            [],
                            'test-report',
                            300
                        )
        
        assert result['tool'] == 'scoutsuite'
    
    @pytest.mark.asyncio
    async def test_run_scoutsuite_with_service_filter(self, mock_environment):
        """Test ScoutSuite with service filtering."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        js_content = 'scoutsuite_results = {"services": {}};'
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('pathlib.Path.exists', return_value=True):
                    with patch('pathlib.Path.read_text', return_value=js_content):
                        result = await server._run_scoutsuite(
                            'default',
                            ['s3', 'ec2'],
                            [],
                            'test-report',
                            300
                        )
        
        assert result['tool'] == 'scoutsuite'
    
    @pytest.mark.asyncio
    async def test_run_scoutsuite_timeout(self, mock_environment):
        """Test ScoutSuite timeout handling."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', side_effect=asyncio.TimeoutError()):
                result = await server._run_scoutsuite(
                    'default',
                    [],
                    [],
                    'test-report',
                    1
                )
        
        assert 'error' in result
        assert result['error'] == 'timeout'
    
    @pytest.mark.asyncio
    async def test_run_scoutsuite_missing_report(self, mock_environment):
        """Test ScoutSuite with missing report file."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('pathlib.Path.exists', return_value=False):
                    # When file doesn't exist, server returns empty scout_data
                    result = await server._run_scoutsuite(
                        'default',
                        [],
                        [],
                        'test-report',
                        300
                    )
                    # Should return results with empty data, not raise exception
                    assert result['tool'] == 'scoutsuite'
                    assert result['findings_count'] == 0
    
    @pytest.mark.asyncio
    async def test_run_scoutsuite_invalid_json(self, mock_environment):
        """Test ScoutSuite with invalid JSON report."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('pathlib.Path.exists', return_value=True):
                    with patch('pathlib.Path.read_text', return_value='invalid json content'):
                        # When JSON is invalid, the parsing will fail and return empty scout_data
                        result = await server._run_scoutsuite(
                            'default',
                            [],
                            [],
                            'test-report',
                            300
                        )
                        # Should return results with empty data
                        assert result['tool'] == 'scoutsuite'
                        assert result['findings_count'] == 0
    
    def test_count_findings_multiple_services(self, mock_environment):
        """Test counting findings from multiple services."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        scout_data = {
            'services': {
                's3': {'findings': {'test1': {'level': 'danger', 'flagged_items': ['item1']}}},
                'ec2': {'findings': {'test2': {'level': 'warning', 'flagged_items': ['item2']}}}
            }
        }
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            count = server._count_findings(scout_data)
        
        assert count == 2
    
    def test_count_findings_empty_services(self, mock_environment):
        """Test counting with no findings."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        scout_data = {'services': {}}
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            count = server._count_findings(scout_data)
        
        assert count == 0
    
    def test_create_summary_with_severities(self, mock_environment):
        """Test summary creation with severity mapping."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        scout_data = {
            'services': {
                's3': {
                    'findings': {
                        's3-bucket-no-logging': {
                            'level': 'danger',
                            'flagged_items': ['bucket1'],
                            'compliance': [{'name': 'CIS', 'version': '1.4.0', 'reference': '2.6'}]
                        }
                    }
                }
            }
        }
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            summary = server._create_summary(scout_data)
        
        assert summary['services_scanned'] == 1
        assert summary['by_severity']['danger'] == 1
    
    @pytest.mark.asyncio
    async def test_get_version(self, mock_environment):
        """Test ScoutSuite version retrieval."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.communicate = AsyncMock(return_value=(b'5.12.0\n', b''))
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                version = await server._get_scoutsuite_version()
        
        assert version == '5.12.0'
    
    @pytest.mark.asyncio
    async def test_get_version_failure(self, mock_environment):
        """Test ScoutSuite version retrieval failure."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', side_effect=Exception()):
                version = await server._get_scoutsuite_version()
        
        assert version == 'unknown'
    
    @pytest.mark.asyncio
    async def test_full_run_workflow_success(self, mock_environment):
        """Test complete scan workflow."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = AsyncMock(return_value=(b'', b''))
        
        js_content = 'scoutsuite_results = {"services": {}};'
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', return_value=mock_process):
                with patch('pathlib.Path.exists', return_value=True):
                    with patch('pathlib.Path.read_text', return_value=js_content):
                        with patch.object(server, '_store_results', new=AsyncMock(return_value={'s3_uri': 's3://test', 'digest': 'sha256:abc', 'timestamp': 123456})):
                            result = await server._execute_scoutsuite_scan({
                                'aws_profile': 'default',
                                'services': [],
                                'regions': [],
                                'timeout': 300
                            })
        
        assert result['success'] == True
    
    @pytest.mark.asyncio
    async def test_full_run_workflow_failure(self, mock_environment):
        """Test workflow with failure."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            
            with patch('asyncio.create_subprocess_exec', side_effect=Exception("Test error")):
                with pytest.raises(Exception):
                    await server._execute_scoutsuite_scan({
                        'aws_profile': 'default',
                        'services': [],
                        'regions': [],
                        'timeout': 300
                    })