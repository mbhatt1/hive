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
            with patch('boto3.client') as mock_boto:
                mock_boto.return_value = Mock()
                server = ScoutSuiteMCPServer()
        
        assert server is not None
        assert hasattr(server, 'run')
        assert server.tool_name == 'scoutsuite-mcp'
        assert server.aws_account == '123456789012'
    
    def test_severity_mapping(self, mock_environment):
        """Test ScoutSuite severity level mapping."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto:
                mock_boto.return_value = Mock()
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
            with patch('boto3.client') as mock_boto:
                mock_boto.return_value = Mock()
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
    
    def test_run_scoutsuite_success(self, mock_s3_client, mock_dynamodb_client, mock_environment):
        """Test successful ScoutSuite scan execution."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        # Mock ScoutSuite command execution
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        
        # Mock report file content
        mock_report_content = '''scoutsuite_results = {
            "services": {
                "iam": {
                    "findings": {
                        "iam-user-no-mfa": {
                            "description": "IAM user without MFA",
                            "level": "warning",
                            "items": ["user1", "user2"]
                        }
                    }
                }
            }
        }'''
        
        with patch.dict('os.environ', {**mock_environment, 'AWS_PROFILE': 'test'}):
            with patch('boto3.client') as mock_boto:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                mock_boto.side_effect = client_factory
                
                with patch('subprocess.run', return_value=mock_result):
                    with patch('pathlib.Path.exists', return_value=True):
                        with patch('pathlib.Path.mkdir'):
                            with patch('builtins.open', MagicMock(return_value=MagicMock(
                                __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value=mock_report_content))),
                                __exit__=MagicMock(return_value=False)
                            ))):
                                server = ScoutSuiteMCPServer()
                                results = server._run_scoutsuite()
        
        assert results['tool'] == 'scoutsuite'
        assert len(results['results']) == 1
        assert results['results'][0]['service'] == 'iam'
        assert results['results'][0]['severity'] == 'high'
    
    def test_run_scoutsuite_with_access_keys(self, mock_s3_client, mock_dynamodb_client, mock_environment):
        """Test ScoutSuite with AWS access keys."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        mock_result.stdout = 'ScoutSuite 5.12.0'
        
        mock_report_content = 'scoutsuite_results = {"services": {}}'
        
        env_with_keys = {
            **mock_environment,
            'AWS_ACCESS_KEY_ID': 'AKIAIOSFODNN7EXAMPLE',
            'AWS_SECRET_ACCESS_KEY': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            'AWS_SESSION_TOKEN': 'FwoGZXIvYXdzEPj//////////wEaDK'
        }
        
        with patch.dict('os.environ', env_with_keys):
            with patch('boto3.client') as mock_boto:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                mock_boto.side_effect = client_factory
                
                with patch('subprocess.run', return_value=mock_result) as mock_run:
                    with patch('pathlib.Path.exists', return_value=True):
                        with patch('pathlib.Path.mkdir'):
                            with patch('builtins.open', MagicMock(return_value=MagicMock(
                                __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value=mock_report_content))),
                                __exit__=MagicMock(return_value=False)
                            ))):
                                server = ScoutSuiteMCPServer()
                                results = server._run_scoutsuite()
                    
                    # Verify access keys were used - check all calls to find the scoutsuite command
                    found_access_keys = False
                    for call in mock_run.call_args_list:
                        call_args = call[0][0]
                        if isinstance(call_args, list) and 'scout' in call_args and 'aws' in call_args:
                            assert '--access-keys' in call_args
                            assert '--session-token' in call_args
                            found_access_keys = True
                            break
                    assert found_access_keys, "ScoutSuite command with access keys not found in subprocess calls"
    
    def test_run_scoutsuite_with_service_filter(self, mock_s3_client, mock_dynamodb_client, mock_environment):
        """Test ScoutSuite with specific service filtering."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        mock_result.stdout = 'ScoutSuite 5.12.0'
        
        mock_report_content = 'scoutsuite_results = {"services": {}}'
        
        env_with_services = {
            **mock_environment,
            'SERVICES': 'iam,s3,ec2'
        }
        
        with patch.dict('os.environ', env_with_services):
            with patch('boto3.client') as mock_boto:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                mock_boto.side_effect = client_factory
                
                with patch('subprocess.run', return_value=mock_result) as mock_run:
                    with patch('pathlib.Path.exists', return_value=True):
                        with patch('pathlib.Path.mkdir'):
                            with patch('builtins.open', MagicMock(return_value=MagicMock(
                                __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value=mock_report_content))),
                                __exit__=MagicMock(return_value=False)
                            ))):
                                server = ScoutSuiteMCPServer()
                                results = server._run_scoutsuite()
                    
                    # Verify services filter was applied - check all calls
                    found_services = False
                    for call in mock_run.call_args_list:
                        call_args = call[0][0]
                        if isinstance(call_args, list) and 'scout' in call_args and 'aws' in call_args:
                            assert '--services' in call_args
                            assert 'iam' in call_args
                            assert 's3' in call_args
                            found_services = True
                            break
                    assert found_services, "ScoutSuite command with services filter not found in subprocess calls"
    
    def test_run_scoutsuite_timeout(self, mock_environment):
        """Test ScoutSuite timeout handling."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        import subprocess
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', side_effect=subprocess.TimeoutExpired('scout', 1800)):
                server = ScoutSuiteMCPServer()
                results = server._run_scoutsuite()
        
        assert results['tool'] == 'scoutsuite'
        assert results['error'] == 'timeout'
        assert results['results'] == []
    
    def test_run_scoutsuite_missing_report(self, mock_environment):
        """Test ScoutSuite when report file is missing."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', return_value=mock_result):
                with patch('pathlib.Path.exists', return_value=False):
                    server = ScoutSuiteMCPServer()
                    results = server._run_scoutsuite()
        
        assert results['tool'] == 'scoutsuite'
        assert results['results'] == []
    
    def test_run_scoutsuite_invalid_json(self, mock_environment):
        """Test ScoutSuite with invalid JSON in report."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        
        # Invalid JSON content
        mock_report_content = 'scoutsuite_results = { invalid json here }'
        
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto:
                mock_boto.return_value = Mock()
                with patch('subprocess.run', return_value=mock_result):
                    with patch('pathlib.Path.exists', return_value=True):
                        with patch('builtins.open', MagicMock(return_value=MagicMock(
                            __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value=mock_report_content))),
                            __exit__=MagicMock(return_value=False)
                        ))):
                            server = ScoutSuiteMCPServer()
                            results = server._run_scoutsuite()
        
        # Should handle error gracefully
        assert 'error' in results
    
    def test_parse_findings_multiple_services(self, mock_environment):
        """Test parsing findings from multiple AWS services."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        scan_data = {
            'services': {
                'iam': {
                    'findings': {
                        'iam-finding-1': {
                            'description': 'IAM issue',
                            'level': 'danger',
                            'items': ['item1']
                        }
                    }
                },
                's3': {
                    'findings': {
                        's3-finding-1': {
                            'description': 'S3 issue',
                            'level': 'warning',
                            'items': ['bucket1', 'bucket2']
                        }
                    }
                },
                'ec2': {
                    'findings': {
                        'ec2-finding-1': {
                            'description': 'EC2 issue',
                            'level': 'info',
                            'items': []
                        }
                    }
                }
            }
        }
        
        findings = server._parse_findings(scan_data)
        
        assert len(findings) == 3
        services = [f['service'] for f in findings]
        assert 'iam' in services
        assert 's3' in services
        assert 'ec2' in services
    
    def test_parse_findings_empty_services(self, mock_environment):
        """Test parsing when no findings exist."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        scan_data = {'services': {}}
        findings = server._parse_findings(scan_data)
        
        assert findings == []
    
    def test_parse_findings_with_compliance(self, mock_environment):
        """Test parsing findings with compliance info."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = ScoutSuiteMCPServer()
        
        scan_data = {
            'services': {
                'iam': {
                    'findings': {
                        'cis-benchmark-fail': {
                            'description': 'CIS benchmark failure',
                            'level': 'danger',
                            'items': ['policy1'],
                            'compliance': ['CIS-AWS-1.1', 'NIST-800-53'],
                            'references': ['https://docs.aws.amazon.com']
                        }
                    }
                }
            }
        }
        
        findings = server._parse_findings(scan_data)
        
        assert len(findings) == 1
        assert 'CIS-AWS-1.1' in findings[0]['compliance']
        assert len(findings[0]['references']) > 0
    
    def test_get_version(self, mock_environment):
        """Test getting ScoutSuite version."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_result = Mock()
        mock_result.stdout = 'ScoutSuite 5.12.0\n'
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', return_value=mock_result):
                server = ScoutSuiteMCPServer()
                version = server._get_version()
        
        assert 'ScoutSuite' in version
    
    def test_get_version_failure(self, mock_environment):
        """Test version extraction when scout command fails."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', side_effect=Exception('Command not found')):
                server = ScoutSuiteMCPServer()
                version = server._get_version()
        
        assert version == 'unknown'
    
    def test_full_run_workflow_success(self, mock_s3_client, mock_dynamodb_client, mock_environment):
        """Test complete run workflow from start to finish."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        
        mock_report_content = '''scoutsuite_results = {
            "services": {
                "s3": {
                    "findings": {
                        "s3-bucket-public": {
                            "description": "Public S3 bucket",
                            "level": "danger",
                            "items": ["bucket1"]
                        }
                    }
                }
            }
        }'''
        
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                mock_boto.side_effect = client_factory
                
                with patch('subprocess.run', return_value=mock_result):
                    with patch('pathlib.Path.exists', return_value=True):
                        with patch('pathlib.Path.mkdir'):
                            with patch('builtins.open', MagicMock(return_value=MagicMock(
                                __enter__=MagicMock(return_value=MagicMock(read=MagicMock(return_value=mock_report_content))),
                                __exit__=MagicMock(return_value=False)
                            ))):
                                server = ScoutSuiteMCPServer()
                                # Mock _write_results to avoid JSON serialization of Mock objects
                                with patch.object(server, '_write_results') as mock_write:
                                    exit_code = server.run()
                                    # Verify _write_results was called
                                    assert mock_write.called
        
        assert exit_code == 0
    
    def test_full_run_workflow_failure(self, mock_s3_client, mock_dynamodb_client, mock_environment):
        """Test run workflow when scan fails."""
        from src.mcp_servers.scoutsuite_mcp.server import ScoutSuiteMCPServer
        
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                mock_boto.side_effect = client_factory
                
                # Simulate failure in _run_scoutsuite itself, not just subprocess
                with patch('pathlib.Path.mkdir'):
                    server = ScoutSuiteMCPServer()
                    # Mock _run_scoutsuite to raise exception
                    with patch.object(server, '_run_scoutsuite', side_effect=Exception('Scan failed')):
                        exit_code = server.run()
        
        assert exit_code == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])