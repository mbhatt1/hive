"""
Unit Tests for Pacu MCP Server
===============================

Tests Pacu AWS exploit validation implementation.
"""

import pytest
import json
from unittest.mock import Mock, patch
import subprocess


@pytest.mark.mcp
@pytest.mark.unit
class TestPacuMCP:
    """Test suite for Pacu MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', {
            **mock_environment,
            'AWS_ACCOUNT_ID': '123456789012',
            'AWS_TARGET_REGION': 'us-east-1',
            'FINDINGS': '[]'
        }):
            server = PacuMCPServer()
        
        assert server is not None
        assert hasattr(server, 'run')
        assert server.tool_name == 'pacu-mcp'
        assert server.aws_account == '123456789012'
        assert server.session_name.startswith('hivemind_')
    
    def test_finding_to_module_mapping(self, mock_environment):
        """Test finding to Pacu module mapping."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
        
        # Test service-based mapping
        assert server._map_finding_to_module('iam', '') == 'iam__enum_permissions'
        assert server._map_finding_to_module('s3', '') == 's3__bucket_finder'
        assert server._map_finding_to_module('ec2', '') == 'ec2__enum_instances'
        
        # Test finding-specific overrides
        assert server._map_finding_to_module('iam', 'policy-check') == 'iam__enum_policies'
        assert server._map_finding_to_module('s3', 'bucket-permissions') == 's3__bucket_finder'
        assert server._map_finding_to_module('ec2', 'security-group-open') == 'ec2__enum_security_groups'
    
    def test_analyze_module_result(self, mock_environment):
        """Test module result analysis for exploitability."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
        
        finding = {'finding_id': 'test'}
        
        # Test exploitable result
        result_exploitable = {
            'success': True,
            'output': 'Successfully found 5 vulnerable resources. Discovered exposed credentials.'
        }
        assert server._analyze_module_result(result_exploitable, finding) is True
        
        # Test not exploitable result
        result_not_exploitable = {
            'success': True,
            'output': 'No results found. Access denied to all resources.'
        }
        assert server._analyze_module_result(result_not_exploitable, finding) is False
        
        # Test failed execution
        result_failed = {
            'success': False,
            'output': 'Error occurred'
        }
        assert server._analyze_module_result(result_failed, finding) is False
    
    def test_run_pacu_module(self, mock_environment):
        """Test running a Pacu module."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run') as mock_run:
                mock_run.return_value = Mock(
                    returncode=0,
                    stdout='Module executed successfully',
                    stderr=''
                )
                
                server = PacuMCPServer()
                result = server._run_pacu_module('iam__enum_permissions')
                
                assert result['module'] == 'iam__enum_permissions'
                assert result['success'] is True
                assert 'Module executed successfully' in result['output']
    
    def test_run_pacu_module_timeout(self, mock_environment):
        """Test Pacu module timeout handling."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run') as mock_run:
                mock_run.side_effect = subprocess.TimeoutExpired('pacu', 300)
                
                server = PacuMCPServer()
                result = server._run_pacu_module('iam__enum_permissions')
                
                assert result['success'] is False
                assert 'timed' in result['errors'].lower() or 'timeout' in result['errors'].lower()
    
    def test_validate_single_finding(self, mock_environment):
        """Test validation of a single finding."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            
            finding = {
                'finding_id': 'f1',
                'service': 'iam',
                'finding_key': 'policy-overly-permissive'
            }
            
            with patch.object(server, '_run_pacu_module') as mock_run:
                mock_run.return_value = {
                    'success': True,
                    'output': 'Found vulnerable policies',
                    'errors': ''
                }
                
                validation = server._validate_single_finding(finding)
                
                assert validation['finding_id'] == 'f1'
                assert validation['service'] == 'iam'
                assert validation['status'] == 'completed'
                assert 'exploitable' in validation
    
    def test_validate_single_finding_no_module(self, mock_environment):
        """Test validation when no module is available."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            
            finding = {
                'finding_id': 'f2',
                'service': 'unknown_service',
                'finding_key': 'test'
            }
            
            validation = server._validate_single_finding(finding)
            
            assert validation['finding_id'] == 'f2'
            assert validation['status'] == 'skipped'
            assert validation['exploitable'] is False
    
    def test_write_results(self, mock_environment):
        """Test writing results to S3 and DynamoDB."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            results = {
                'tool': 'pacu',
                'validations': [
                    {'finding_id': 'f1', 'exploitable': True},
                    {'finding_id': 'f2', 'exploitable': False}
                ]
            }
            
            # The autouse mock fixtures will handle S3 and DynamoDB
            server._write_results(results)
            
            # Just verify no exceptions were raised
            assert True
    
    def test_write_error(self, mock_environment):
        """Test writing error to DynamoDB."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            server._write_error('Validation failed')
            
            # Just verify no exceptions were raised
            assert True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])