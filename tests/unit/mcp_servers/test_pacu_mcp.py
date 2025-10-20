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
    
    def test_intelligent_module_selection(self, mock_environment):
        """Test validation with Claude-recommended modules."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            
            finding = {
                'finding_id': 'iam-001',
                'service': 'iam',
                'title': 'Privilege Escalation Path'
            }
            
            recommended_modules = ['iam__privesc_scan', 'iam__enum_permissions']
            rationale = 'IAM role allows privilege escalation to admin'
            
            with patch.object(server, '_run_pacu_module') as mock_run:
                mock_run.return_value = {
                    'success': True,
                    'output': 'Found privilege escalation path to admin role',
                    'errors': ''
                }
                
                validation = server._validate_with_intelligent_modules(
                    finding, recommended_modules, rationale
                )
                
                assert validation['finding_id'] == 'iam-001'
                assert validation['exploitable'] is True
                assert validation['module'] == 'iam__privesc_scan'
                assert validation['claude_rationale'] == rationale
                assert validation['validation_method'] == 'intelligent_claude_selection'
    
    def test_intelligent_module_selection_not_exploitable(self, mock_environment):
        """Test intelligent validation when no modules confirm exploitability."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            
            finding = {
                'finding_id': 's3-001',
                'service': 's3',
                'title': 'Public Bucket'
            }
            
            recommended_modules = ['s3__bucket_finder', 's3__download_bucket']
            rationale = 'Bucket may be publicly accessible'
            
            with patch.object(server, '_run_pacu_module') as mock_run:
                mock_run.return_value = {
                    'success': True,
                    'output': 'No results found. Access denied.',
                    'errors': ''
                }
                
                validation = server._validate_with_intelligent_modules(
                    finding, recommended_modules, rationale
                )
                
                assert validation['finding_id'] == 's3-001'
                assert validation['exploitable'] is False
                assert 'modules_tried' in validation
                assert validation['claude_rationale'] == rationale
    
    def test_validate_findings_with_priority_map(self, mock_environment):
        """Test validating findings with priority findings from Strategist."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        priority_findings_input = {
            'priority_findings': [
                {
                    'finding_id': 'iam-001',
                    'service': 'iam',
                    'priority_score': 9,
                    'recommended_modules': ['iam__privesc_scan'],
                    'rationale': 'Critical privilege escalation'
                }
            ],
            'findings': [
                {
                    'finding_id': 'iam-001',
                    'service': 'iam',
                    'title': 'Admin Access'
                }
            ]
        }
        
        with patch.dict('os.environ', {**mock_environment, 'FINDINGS': json.dumps(priority_findings_input)}):
            server = PacuMCPServer()
            
            with patch.object(server, '_create_session'):
                with patch.object(server, '_validate_with_intelligent_modules') as mock_validate:
                    mock_validate.return_value = {
                        'finding_id': 'iam-001',
                        'exploitable': True,
                        'validation_method': 'intelligent_claude_selection'
                    }
                    
                    results = server._validate_findings(priority_findings_input)
                    
                    assert len(results['validations']) == 1
                    assert mock_validate.called
    
    def test_validate_findings_without_priority_map(self, mock_environment):
        """Test validating findings using fallback rule-based method."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        findings = [
            {
                'finding_id': 's3-001',
                'service': 's3',
                'finding_key': 'bucket-public'
            }
        ]
        
        with patch.dict('os.environ', {**mock_environment, 'FINDINGS': json.dumps(findings)}):
            server = PacuMCPServer()
            
            with patch.object(server, '_validate_single_finding') as mock_validate:
                mock_validate.return_value = {
                    'finding_id': 's3-001',
                    'exploitable': False,
                    'status': 'completed'
                }
                
                results = server._validate_findings(findings)
                
                assert len(results['validations']) == 1
                assert mock_validate.called
    
    def test_validate_findings_error_handling(self, mock_environment):
        """Test error handling during finding validation."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        findings = [
            {
                'finding_id': 'error-001',
                'service': 'iam'
            }
        ]
        
        with patch.dict('os.environ', {**mock_environment, 'FINDINGS': json.dumps(findings)}):
            server = PacuMCPServer()
            
            with patch.object(server, '_validate_single_finding') as mock_validate:
                mock_validate.side_effect = Exception('Validation error')
                
                results = server._validate_findings(findings)
                
                assert len(results['validations']) == 1
                assert results['validations'][0]['status'] == 'error'
                assert results['validations'][0]['exploitable'] is False
    
    def test_create_session(self, mock_environment):
        """Test creating a Pacu session."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', return_value=mock_result) as mock_run:
                with patch('pathlib.Path.mkdir'):
                    server = PacuMCPServer()
                    server._create_session()
                    
                    # Verify pacu was called with session name
                    call_args = mock_run.call_args[0][0]
                    assert 'pacu' in call_args
                    assert '--session' in call_args
    
    def test_create_session_with_access_keys(self, mock_environment):
        """Test creating session with AWS access keys."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stderr = ''
        
        env_with_keys = {
            **mock_environment,
            'AWS_ACCESS_KEY_ID': 'AKIAIOSFODNN7EXAMPLE',
            'AWS_SECRET_ACCESS_KEY': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            'AWS_SESSION_TOKEN': 'FwoGZXIvYXdzEPj'
        }
        
        with patch.dict('os.environ', env_with_keys):
            with patch('subprocess.run', return_value=mock_result) as mock_run:
                with patch('pathlib.Path.mkdir'):
                    server = PacuMCPServer()
                    server._create_session()
                    
                    # Verify environment was passed
                    call_kwargs = mock_run.call_args[1]
                    assert 'env' in call_kwargs
                    assert call_kwargs['env']['AWS_ACCESS_KEY_ID'] == 'AKIAIOSFODNN7EXAMPLE'
    
    def test_create_session_failure(self, mock_environment):
        """Test session creation failure handling."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', side_effect=Exception('Session error')):
                with patch('pathlib.Path.mkdir'):
                    server = PacuMCPServer()
                    
                    with pytest.raises(Exception):
                        server._create_session()
    
    def test_get_version(self, mock_environment):
        """Test getting Pacu version."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        mock_result = Mock()
        mock_result.stdout = 'Pacu v1.5.0\n'
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', return_value=mock_result):
                server = PacuMCPServer()
                version = server._get_version()
        
        assert 'Pacu' in version or '1.5.0' in version
    
    def test_get_version_failure(self, mock_environment):
        """Test version extraction when pacu command fails."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            with patch('subprocess.run', side_effect=Exception('Command not found')):
                server = PacuMCPServer()
                version = server._get_version()
        
        assert version == 'unknown'
    
    def test_full_run_workflow_success(self, mock_environment):
        """Test complete run workflow with successful validation."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        findings = [
            {
                'finding_id': 'iam-001',
                'service': 'iam',
                'finding_key': 'policy-check'
            }
        ]
        
        mock_session_result = Mock(returncode=0, stderr='')
        mock_module_result = Mock(
            returncode=0,
            stdout='Found exploitable resources',
            stderr=''
        )
        
        with patch.dict('os.environ', {**mock_environment, 'FINDINGS': json.dumps(findings)}):
            with patch('subprocess.run') as mock_run:
                def run_side_effect(cmd, *args, **kwargs):
                    if '--list-modules' in cmd:
                        return mock_session_result
                    else:
                        return mock_module_result
                
                mock_run.side_effect = run_side_effect
                
                with patch('pathlib.Path.mkdir'):
                    server = PacuMCPServer()
                    exit_code = server.run()
        
        assert exit_code == 0
    
    def test_full_run_workflow_failure(self, mock_environment):
        """Test run workflow when validation fails."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', {**mock_environment, 'FINDINGS': 'invalid json'}):
            server = PacuMCPServer()
            exit_code = server.run()
        
        assert exit_code == 1
    
    def test_analyze_module_result_edge_cases(self, mock_environment):
        """Test edge cases in module result analysis."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            finding = {'finding_id': 'test'}
            
            # Test empty output
            result_empty = {'success': True, 'output': ''}
            assert server._analyze_module_result(result_empty, finding) is False
            
            # Test mixed indicators (more negative)
            result_mixed = {
                'success': True,
                'output': 'Found one item but access denied to most. Error in permissions.'
            }
            assert server._analyze_module_result(result_mixed, finding) is False
            
            # Test uppercase indicators
            result_uppercase = {
                'success': True,
                'output': 'FOUND MULTIPLE VULNERABLE RESOURCES. SUCCESSFULLY ENUMERATED PERMISSIONS.'
            }
            assert server._analyze_module_result(result_uppercase, finding) is True
    
    def test_map_finding_lambda_rds_kms(self, mock_environment):
        """Test finding mapping for Lambda, RDS, and KMS services."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            
            assert server._map_finding_to_module('lambda', '') == 'lambda__enum'
            assert server._map_finding_to_module('rds', '') == 'rds__enum'
            assert server._map_finding_to_module('kms', '') == 'kms__enum'
            assert server._map_finding_to_module('cloudtrail', '') == 'cloudtrail__download_event_history'
    
    def test_intelligent_modules_with_empty_list(self, mock_environment):
        """Test intelligent validation with empty module list."""
        from src.mcp_servers.pacu_mcp.server import PacuMCPServer
        
        with patch.dict('os.environ', mock_environment):
            server = PacuMCPServer()
            
            finding = {
                'finding_id': 'test-001',
                'service': 'iam'
            }
            
            validation = server._validate_with_intelligent_modules(
                finding, [], 'No modules recommended'
            )
            
            assert validation['exploitable'] is False
            assert validation['modules_tried'] == []


if __name__ == '__main__':
    pytest.main([__file__, '-v'])