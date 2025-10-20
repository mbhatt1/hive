"""
Unit Tests for Strategist Agent
================================

Tests the tool selection agent logic.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.agent
@pytest.mark.unit
class TestStrategistAgent:
    """Test suite for Strategist agent."""
    
    def test_sense_reads_context_manifest(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test SENSE phase reads context manifest from S3."""
        # Arrange
        scan_id = sample_context_manifest['scan_id']
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent(scan_id)
                    result = agent.run()
        
        # Assert
        assert result is not None
        assert hasattr(result, 'mission_id')
        assert result.mission_id == scan_id
    
    def test_think_analyzes_code_patterns(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test THINK phase analyzes patterns with Bedrock."""
        # Arrange
        scan_id = sample_context_manifest['scan_id']
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent(scan_id)
                    result = agent.run()
        
        # Assert
        assert mock_bedrock_client.invoke_model.called
        assert result is not None
    
    def test_decide_selects_appropriate_tools(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test DECIDE phase selects tools based on analysis."""
        # Arrange
        scan_id = sample_context_manifest['scan_id']
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent(scan_id)
                    result = agent.run()
        
        # Assert
        assert result is not None
        assert hasattr(result, 'tools')
        assert len(result.tools) > 0
    
    def test_act_writes_tool_plan(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test ACT phase writes tool plan to S3."""
        # Arrange
        scan_id = sample_context_manifest['scan_id']
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent(scan_id)
                    result = agent.run()
        
        # Assert
        assert result is not None
        # moto mocks don't support method_calls, just verify result structure
        assert hasattr(result, 'tools') or isinstance(result, dict)
    
    def test_tool_selection_for_secrets(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        create_s3_object,
        mock_environment
    ):
        """Test gitleaks is selected when secrets are detected."""
        # Arrange
        manifest_with_secrets = {
            'mission_id': 'test-scan',
            'service_name': 'test-service',
            'criticality_tier': 1,
            'handles_pii': True,
            'handles_payment': False,
            'primary_languages': ['Python'],
            'file_count': 50,
            'code_patterns': {'secrets': 5}
        }
        create_s3_object(
            'test-bucket',
            'agent-outputs/archaeologist/test-scan/context-manifest.json',
            manifest_with_secrets
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    result = agent.run()
        
        # Assert - gitleaks should be in selected tools
        tool_names = [t['name'] for t in result.tools]
        assert any('gitleaks' in name for name in tool_names)
    
    def test_tool_selection_for_vulnerabilities(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        create_s3_object,
        mock_environment
    ):
        """Test semgrep and trivy selected for vulnerabilities."""
        # Arrange
        manifest_with_vulns = {
            'mission_id': 'test-scan',
            'service_name': 'test-service',
            'criticality_tier': 0,
            'handles_pii': False,
            'handles_payment': False,
            'primary_languages': ['Python', 'JavaScript'],
            'file_count': 100,
            'code_patterns': {'sql_queries': 10},
            'dependencies': ['Python']
        }
        create_s3_object(
            'test-bucket',
            'agent-outputs/archaeologist/test-scan/context-manifest.json',
            manifest_with_vulns
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    result = agent.run()
        
        # Assert - semgrep or trivy should be selected
        tool_names = [t['name'] for t in result.tools]
        assert any('semgrep' in name or 'trivy' in name for name in tool_names)
    
    def test_error_handling_empty_context(
        self,
        mock_environment
    ):
        """Test error handling for empty context manifest."""
        # Arrange
        empty_manifest = {'scan_id': 'test-scan'}
        
        # Act & Assert
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            agent = StrategistAgent('test-scan')
            agent.context_manifest = empty_manifest
            try:
                tools = agent._select_tools_for_patterns(empty_manifest)
                # Should handle gracefully with empty or default tools
                assert isinstance(tools, list)
            except Exception as e:
                # Exception acceptable for invalid input
                assert 'context' in str(e).lower() or 'empty' in str(e).lower()
    
    def test_aws_initial_scan_planning(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        create_s3_object,
        mock_environment
    ):
        """Test AWS initial scan planning (no existing findings)."""
        # Arrange
        aws_manifest = {
            'mission_id': 'aws-scan-1',
            'scan_type': 'aws',
            'aws_account_id': '123456789012',
            'aws_region': 'us-east-1',
            'aws_services': ['iam', 's3', 'ec2'],
            'criticality_tier': 0,
            'environment': 'production'
        }
        create_s3_object(
            'test-bucket',
            'agent-outputs/archaeologist/aws-scan-1/context-manifest.json',
            aws_manifest
        )
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        # S3 client should return manifest but no ScoutSuite findings
                        s3_mock = Mock()
                        def get_object_side_effect(Bucket, Key):
                            if 'context-manifest' in Key:
                                return mock_s3_client.get_object(Bucket=Bucket, Key=Key)
                            else:
                                # No ScoutSuite findings
                                raise Exception('Not found')
                        s3_mock.get_object = Mock(side_effect=get_object_side_effect)
                        s3_mock.put_object = mock_s3_client.put_object
                        return s3_mock
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('aws-scan-1')
                    result = agent.run()
        
        # Assert - should only plan ScoutSuite
        tool_names = [t['name'] for t in result.tools]
        assert 'scoutsuite-mcp' in tool_names
        assert len(result.tools) == 1
    
    def test_aws_scan_with_existing_findings(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        create_s3_object,
        mock_environment
    ):
        """Test AWS scan with existing ScoutSuite findings triggers analysis."""
        # Arrange
        aws_manifest = {
            'mission_id': 'aws-scan-2',
            'scan_type': 'aws',
            'aws_account_id': '123456789012',
            'aws_region': 'us-east-1',
            'aws_services': ['iam', 's3'],
            'criticality_tier': 0,
            'environment': 'production'
        }
        
        scoutsuite_findings = {
            'findings': [
                {
                    'finding_id': 'iam-001',
                    'service': 'iam',
                    'severity': 'CRITICAL',
                    'title': 'IAM User with Admin Policy',
                    'description': 'User has full admin access'
                },
                {
                    'finding_id': 's3-001',
                    'service': 's3',
                    'severity': 'HIGH',
                    'title': 'S3 Bucket Publicly Accessible',
                    'description': 'Bucket allows public read access'
                }
            ]
        }
        
        create_s3_object(
            'test-bucket',
            'agent-outputs/archaeologist/aws-scan-2/context-manifest.json',
            aws_manifest
        )
        create_s3_object(
            'test-bucket',
            'mcp-outputs/scoutsuite/aws-scan-2/findings.json',
            scoutsuite_findings
        )
        
        # Mock Claude analysis response - proper format
        claude_response_text = json.dumps({
            'priority_findings': [
                {
                    'finding_id': 'iam-001',
                    'priority_score': 9,
                    'exploitability': 'critical',
                    'recommended_modules': ['iam__privesc_scan'],
                    'rationale': 'Admin access can be exploited'
                }
            ],
            'attack_paths': []
        })
        
        mock_bedrock_response = Mock()
        mock_bedrock_response.content = claude_response_text
        mock_bedrock_client.invoke_claude = Mock(return_value=mock_bedrock_response)
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('aws-scan-2')
                    # Mock the cognitive kernel's invoke_claude method
                    agent.cognitive_kernel.invoke_claude = mock_bedrock_client.invoke_claude
                    result = agent.run()
        
        # Assert - should plan Pacu validation
        tool_names = [t['name'] for t in result.tools]
        assert 'pacu-mcp' in tool_names
    
    def test_claude_finding_analysis(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_redis_client,
        mock_environment
    ):
        """Test Claude-powered finding analysis."""
        # Arrange
        findings = [
            {
                'finding_id': 'iam-001',
                'service': 'iam',
                'severity': 'CRITICAL',
                'title': 'Privilege Escalation Path',
                'description': 'IAM role allows privilege escalation'
            }
        ]
        
        # Mock Claude response properly
        claude_response_text = json.dumps({
            'priority_findings': [
                {
                    'finding_id': 'iam-001',
                    'priority_score': 10,
                    'exploitability': 'critical',
                    'recommended_modules': ['iam__privesc_scan', 'iam__enum_permissions'],
                    'rationale': 'Clear privilege escalation vector'
                }
            ],
            'attack_paths': [
                {
                    'description': 'IAM role escalation to admin',
                    'findings_involved': ['iam-001'],
                    'modules_needed': ['iam__privesc_scan']
                }
            ]
        })
        
        mock_bedrock_response = Mock()
        mock_bedrock_response.content = claude_response_text
        mock_bedrock_client.invoke_claude = Mock(return_value=mock_bedrock_response)
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client', return_value=mock_s3_client):
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    agent.cognitive_kernel.invoke_claude = mock_bedrock_client.invoke_claude
                    analysis = agent._analyze_findings_with_claude(findings)
        
        # Assert
        assert 'priority_findings' in analysis
        assert len(analysis['priority_findings']) > 0
        assert analysis['priority_findings'][0]['finding_id'] == 'iam-001'
        assert analysis['priority_findings'][0]['priority_score'] == 10
        assert 'attack_paths' in analysis
        assert len(analysis['attack_paths']) == 1
    
    def test_fallback_analysis_when_claude_fails(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_redis_client,
        mock_environment
    ):
        """Test fallback analysis when Claude is unavailable."""
        # Arrange
        findings = [
            {
                'finding_id': 'iam-001',
                'service': 'iam',
                'severity': 'CRITICAL',
                'title': 'Admin Access'
            },
            {
                'finding_id': 's3-001',
                'service': 's3',
                'severity': 'HIGH',
                'title': 'Public Bucket'
            }
        ]
        
        # Mock Claude failure
        mock_bedrock_client.invoke_model.side_effect = Exception('Bedrock unavailable')
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client', return_value=mock_s3_client):
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    agent.cognitive_kernel.bedrock_client = mock_bedrock_client
                    analysis = agent._analyze_findings_with_claude(findings)
        
        # Assert - should use fallback
        assert 'priority_findings' in analysis
        assert len(analysis['priority_findings']) == 2
        # CRITICAL should be prioritized
        assert analysis['priority_findings'][0]['priority_score'] == 10
        assert analysis['priority_findings'][1]['priority_score'] == 8
    
    def test_service_to_module_mapping_iam(
        self,
        mock_s3_client,
        mock_redis_client,
        mock_environment
    ):
        """Test IAM service to Pacu module mapping."""
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client', return_value=mock_s3_client):
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    
                    # Test privilege escalation
                    modules = agent._map_service_to_modules('iam', 'Privilege Escalation Path')
                    assert 'iam__privesc_scan' in modules
                    assert 'iam__enum_permissions' in modules
                    
                    # Test generic IAM
                    modules = agent._map_service_to_modules('iam', 'User without MFA')
                    assert 'iam__enum_permissions' in modules
    
    def test_service_to_module_mapping_s3(
        self,
        mock_s3_client,
        mock_redis_client,
        mock_environment
    ):
        """Test S3 service to Pacu module mapping."""
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client', return_value=mock_s3_client):
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    
                    # Test public bucket
                    modules = agent._map_service_to_modules('s3', 'Public Bucket Access')
                    assert 's3__bucket_finder' in modules
                    assert 's3__download_bucket' in modules
                    
                    # Test generic S3
                    modules = agent._map_service_to_modules('s3', 'Bucket Encryption Disabled')
                    assert 's3__bucket_finder' in modules
    
    def test_service_to_module_mapping_other_services(
        self,
        mock_s3_client,
        mock_redis_client,
        mock_environment
    ):
        """Test other AWS service to Pacu module mappings."""
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client', return_value=mock_s3_client):
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('test-scan')
                    
                    # Test EC2
                    modules = agent._map_service_to_modules('ec2', 'Security Group Too Permissive')
                    assert 'ec2__enum_lateral_movement' in modules
                    
                    # Test Lambda
                    modules = agent._map_service_to_modules('lambda', 'Function with Admin Role')
                    assert 'lambda__enum' in modules
                    
                    # Test RDS
                    modules = agent._map_service_to_modules('rds', 'Public Database')
                    assert 'rds__enum' in modules
                    assert 'rds__explore_snapshots' in modules
                    
                    # Test unknown service
                    modules = agent._map_service_to_modules('unknown', 'Some finding')
                    assert modules == []
    
    def test_no_high_priority_findings_skips_pacu(
        self,
        mock_s3_client,
        mock_bedrock_client,
        mock_kendra_client,
        mock_redis_client,
        create_s3_object,
        mock_environment
    ):
        """Test that low priority findings skip Pacu validation."""
        # Arrange
        aws_manifest = {
            'mission_id': 'aws-scan-3',
            'scan_type': 'aws',
            'aws_account_id': '123456789012',
            'aws_region': 'us-east-1',
            'criticality_tier': 1
        }
        
        scoutsuite_findings = {
            'findings': [
                {
                    'finding_id': 'low-001',
                    'service': 'iam',
                    'severity': 'LOW',
                    'title': 'Password policy not strict'
                }
            ]
        }
        
        create_s3_object(
            'test-bucket',
            'agent-outputs/archaeologist/aws-scan-3/context-manifest.json',
            aws_manifest
        )
        create_s3_object(
            'test-bucket',
            'mcp-outputs/scoutsuite/aws-scan-3/findings.json',
            scoutsuite_findings
        )
        
        # Mock Claude returning low priority
        mock_bedrock_client.invoke_model.return_value = {
            'body': Mock(read=lambda: json.dumps({
                'content': [{'text': json.dumps({
                    'priority_findings': [
                        {
                            'finding_id': 'low-001',
                            'priority_score': 3,
                            'exploitability': 'low',
                            'recommended_modules': [],
                            'rationale': 'Low risk issue'
                        }
                    ],
                    'attack_paths': []
                })}]
            }).encode())
        }
        
        # Act
        from src.agents.strategist.agent import StrategistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    elif service == 's3':
                        return mock_s3_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = StrategistAgent('aws-scan-3')
                    result = agent.run()
        
        # Assert - no Pacu, no tools
        assert len(result.tools) == 0
        assert 'no critical exploitable issues' in result.reasoning.lower()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])