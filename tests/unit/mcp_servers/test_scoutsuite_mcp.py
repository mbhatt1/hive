"""
Unit Tests for ScoutSuite MCP Server
=====================================

Tests ScoutSuite AWS security scanning implementation.
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path


@pytest.mark.mcp
@pytest.mark.unit
class TestScoutSuiteMCP:
    """Test suite for ScoutSuite MCP server."""
    
    def test_server_initialization(self, mock_environment):
        """Test MCP server initialization."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        with patch.dict('os.environ', {
            **mock_environment,
            'AWS_ACCOUNT_ID': '123456789012',
            'AWS_TARGET_REGION': 'us-east-1'
        }):
            server = ScoutSuiteMCPServer()
        
        assert server is not None
        assert hasattr(server, 'run')
        assert server.tool_name == 'scoutsuite-mcp'
        assert server.aws_account == '123456789012'
    
    def test_severity_mapping(self, mock_environment):
        """Test ScoutSuite severity level mapping."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        assert server._map_severity('danger') == 'critical'
        assert server._map_severity('warning') == 'high'
        assert server._map_severity('info') == 'medium'
        assert server._map_severity('success') == 'low'
        assert server._map_severity('unknown') == 'medium'
    
    def test_parse_findings(self, mock_environment):
        """Test parsing of ScoutSuite scan data."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        scan_data = {
            'services': {
                'iam': {
                    'findings': {
                        'iam-policy-overly-permissive': {
                            'description': 'IAM policy allows overly permissive access',
                            'level': 'danger',
                            'items': ['policy1', 'policy2'],
                            'compliance': ['cis'],
                            'references': ['https://example.com']
                        }
                    }
                }
            }
        }
        
        findings = server._parse_findings(scan_data)
        
        assert len(findings) == 1
        assert findings[0]['service'] == 'iam'
        assert findings[0]['severity'] == 'critical'
        assert findings[0]['items_count'] == 2
    
    def test_count_findings(self, mock_environment):
        """Test counting findings in results."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        results = {
            'results': [
                {'finding_id': 'f1'},
                {'finding_id': 'f2'},
                {'finding_id': 'f3'}
            ]
        }
        
        count = server._count_findings(results)
        assert count == 3
    
    def test_write_results(self, mock_environment):
        """Test writing results to S3 and DynamoDB."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            results = {
                'tool': 'scoutsuite',
                'results': [{'finding_id': 'test'}]
            }
            
            # The autouse mock fixtures will handle S3 and DynamoDB
            server._write_results(results)
            
            # Just verify no exceptions were raised
            assert True
    
    def test_write_error(self, mock_environment):
        """Test writing error to DynamoDB."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
            server._write_error('Test error')
            
            # Just verify no exceptions were raised
            assert True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])