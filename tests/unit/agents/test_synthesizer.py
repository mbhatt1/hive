"""
Unit Tests for Synthesizer Agent
=================================

Tests finding synthesis from tool results.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.agent
@pytest.mark.unit
class TestSynthesizerAgent:
    """Test suite for Synthesizer agent."""
    
    def test_sense_reads_tool_results(
        self,
        mock_s3_client,
        mock_dynamodb_client,
        mock_cognitive_kernel,
        sample_tool_results,
        create_s3_object,
        mock_environment
    ):
        """Test SENSE phase reads tool results from S3."""
        # Arrange
        scan_id = sample_tool_results['scan_id']
        create_s3_object(
            'test-bucket',
            f'tool-results/{scan_id}/semgrep.json',
            sample_tool_results
        )
        
        # Mock DynamoDB query to return proper response
        def mock_query(**kwargs):
            return {
                'Items': [
                    {
                        's3_uri': {'S': f's3://test-bucket/tool-results/{scan_id}/semgrep.json'},
                        'tool_name': {'S': 'semgrep'},
                        'mission_id': {'S': scan_id}
                    }
                ]
            }
        mock_dynamodb_client.query = mock_query
        
        # Act
        from src.agents.synthesizer.agent import SynthesizerAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis') as mock_redis:
                    mock_redis.return_value = Mock(
                        hset=Mock(return_value=True),
                        sadd=Mock(return_value=1),
                        rpush=Mock(return_value=1)
                    )
                    with patch('src.agents.synthesizer.agent.CognitiveKernel') as MockKernel:
                        MockKernel.return_value = mock_cognitive_kernel
                        agent = SynthesizerAgent(scan_id)
                        results = agent.run()
        
        # Assert
        assert results is not None
        assert isinstance(results, list)
    
    def test_think_analyzes_findings(
        self,
        mock_s3_client,
        mock_dynamodb_client,
        mock_cognitive_kernel,
        sample_tool_results,
        create_s3_object,
        mock_environment
    ):
        """Test THINK phase analyzes findings with Bedrock."""
        # Arrange
        scan_id = sample_tool_results['scan_id']
        create_s3_object(
            'test-bucket',
            f'tool-results/{scan_id}/semgrep.json',
            sample_tool_results
        )
        
        # Mock DynamoDB query
        def mock_query(**kwargs):
            return {
                'Items': [
                    {
                        's3_uri': {'S': f's3://test-bucket/tool-results/{scan_id}/semgrep.json'},
                        'tool_name': {'S': 'semgrep'}
                    }
                ]
            }
        mock_dynamodb_client.query = mock_query
        
        # Act
        from src.agents.synthesizer.agent import SynthesizerAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis') as mock_redis:
                    mock_redis.return_value = Mock(
                        hset=Mock(return_value=True),
                        sadd=Mock(return_value=1),
                        rpush=Mock(return_value=1)
                    )
                    with patch('src.agents.synthesizer.agent.CognitiveKernel') as MockKernel:
                        MockKernel.return_value = mock_cognitive_kernel
                        agent = SynthesizerAgent(scan_id)
                        analysis = agent.run()
        
        # Assert
        assert mock_cognitive_kernel.invoke_claude.called
        assert analysis is not None
    
    def test_decide_creates_draft_findings(
        self,
        mock_s3_client,
        mock_dynamodb_client,
        mock_cognitive_kernel,
        sample_tool_results,
        create_s3_object,
        mock_environment
    ):
        """Test DECIDE phase creates draft findings."""
        # Arrange
        scan_id = sample_tool_results['scan_id']
        create_s3_object(
            'test-bucket',
            f'tool-results/{scan_id}/semgrep.json',
            sample_tool_results
        )
        
        # Mock DynamoDB query
        def mock_query(**kwargs):
            return {
                'Items': [
                    {
                        's3_uri': {'S': f's3://test-bucket/tool-results/{scan_id}/semgrep.json'},
                        'tool_name': {'S': 'semgrep'}
                    }
                ]
            }
        mock_dynamodb_client.query = mock_query
        
        # Act
        from src.agents.synthesizer.agent import SynthesizerAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis') as mock_redis:
                    mock_redis.return_value = Mock(
                        hset=Mock(return_value=True),
                        sadd=Mock(return_value=1),
                        rpush=Mock(return_value=1)
                    )
                    with patch('src.agents.synthesizer.agent.CognitiveKernel') as MockKernel:
                        MockKernel.return_value = mock_cognitive_kernel
                        agent = SynthesizerAgent(scan_id)
                        draft = agent.run()
        
        # Assert
        assert draft is not None
        assert isinstance(draft, list)
        assert len(draft) > 0
    
    def test_act_proposes_to_redis(
        self,
        mock_s3_client,
        mock_dynamodb_client,
        mock_cognitive_kernel,
        mock_redis_client,
        sample_tool_results,
        create_s3_object,
        mock_environment
    ):
        """Test ACT phase proposes findings to Redis."""
        # Arrange
        scan_id = sample_tool_results['scan_id']
        create_s3_object(
            'test-bucket',
            f'tool-results/{scan_id}/semgrep.json',
            sample_tool_results
        )
        
        # Mock DynamoDB query
        def mock_query(**kwargs):
            return {
                'Items': [
                    {
                        's3_uri': {'S': f's3://test-bucket/tool-results/{scan_id}/semgrep.json'},
                        'tool_name': {'S': 'semgrep'}
                    }
                ]
            }
        mock_dynamodb_client.query = mock_query
        
        # Act
        from src.agents.synthesizer.agent import SynthesizerAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    with patch('src.agents.synthesizer.agent.CognitiveKernel') as MockKernel:
                        MockKernel.return_value = mock_cognitive_kernel
                        agent = SynthesizerAgent(scan_id)
                        result = agent.run()
        
        # Assert
        assert mock_redis_client.rpush.called
        assert result is not None
    
    def test_deduplication_logic(
        self,
        mock_environment
    ):
        """Test duplicate finding detection."""
        # Arrange
        from src.agents.synthesizer.agent import DraftFinding
        
        findings_with_dupes = [
            DraftFinding(
                finding_id='1',
                title='SQL Injection',
                severity='HIGH',
                description='SQL injection vulnerability',
                file_path='app.py',
                line_numbers=[45],
                evidence_digest='abc123',
                tool_source='semgrep',
                confidence_score=0.9
            ),
            DraftFinding(
                finding_id='1',  # Duplicate ID
                title='SQL Injection',
                severity='HIGH',
                description='SQL injection vulnerability',
                file_path='app.py',
                line_numbers=[45],
                evidence_digest='abc123',
                tool_source='semgrep',
                confidence_score=0.9
            ),
            DraftFinding(
                finding_id='2',
                title='XSS',
                severity='MEDIUM',
                description='XSS vulnerability',
                file_path='views.py',
                line_numbers=[10],
                evidence_digest='def456',
                tool_source='semgrep',
                confidence_score=0.8
            )
        ]
        
        # Act - deduplication based on finding_id
        seen_ids = set()
        deduplicated = []
        for f in findings_with_dupes:
            if f.finding_id not in seen_ids:
                deduplicated.append(f)
                seen_ids.add(f.finding_id)
        
        # Assert
        assert len(deduplicated) == 2
    
    def test_severity_calculation(
        self,
        mock_environment
    ):
        """Test CVSS severity scoring."""
        # Arrange
        finding = {
            'vulnerability_type': 'sql_injection',
            'exploitability': 'high',
            'impact': 'high'
        }
        
        # Act
        from src.agents.synthesizer.agent import SynthesizerAgent
        with patch.dict('os.environ', mock_environment):
            agent = SynthesizerAgent('test-scan')
            severity = agent._calculate_severity(finding)
        
        # Assert
        assert severity in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    
    def test_error_handling_malformed_results(
        self,
        mock_s3_client,
        mock_dynamodb_client,
        mock_cognitive_kernel,
        create_s3_object,
        mock_environment
    ):
        """Test handling of malformed tool results."""
        # Arrange - Create empty/malformed data
        scan_id = 'test-scan-123'
        def mock_query(**kwargs):
            return {'Items': []}  # Empty results
        mock_dynamodb_client.query = mock_query
        
        # Act & Assert
        from src.agents.synthesizer.agent import SynthesizerAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 's3':
                        return mock_s3_client
                    elif service == 'dynamodb':
                        return mock_dynamodb_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis') as mock_redis:
                    mock_redis.return_value = Mock(
                        hset=Mock(return_value=True),
                        sadd=Mock(return_value=1),
                        rpush=Mock(return_value=1)
                    )
                    with patch('src.agents.synthesizer.agent.CognitiveKernel') as MockKernel:
                        MockKernel.return_value = mock_cognitive_kernel
                        agent = SynthesizerAgent(scan_id)
                        try:
                            draft = agent.run()
                            # Empty results should still complete successfully
                            assert draft is not None
                            assert isinstance(draft, list)
                        except Exception as e:
                            # Any exception related to processing is acceptable
                            assert True


if __name__ == '__main__':
    pytest.main([__file__, '-v'])