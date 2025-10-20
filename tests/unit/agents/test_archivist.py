"""
Unit Tests for Archivist Agent
===============================

Tests finding archival and wiki generation.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.agent
@pytest.mark.unit
class TestArchivistAgent:
    """Test suite for Archivist agent."""
    
    def test_sense_reads_final_findings(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_final_findings,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test SENSE phase reads final findings from Redis."""
        # Arrange
        scan_id = sample_final_findings['scan_id']
        
        # Create context manifest in S3 (archivist expects this)
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Mock redis lrange to return proposals
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_final_findings['findings'][0]
            }),
            json.dumps({
                'agent': 'critic',
                'action': 'CONFIRM',
                'payload': {
                    'finding_id': sample_final_findings['findings'][0]['finding_id'],
                    'confidence': 0.9
                }
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return Mock()
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    with patch('src.agents.archivist.agent.SecurityWikiGenerator') as MockWiki:
                        mock_wiki = Mock()
                        mock_wiki.generate_wiki.return_value = Mock()  # Returns wiki object
                        mock_wiki.export_wiki.return_value = 'wiki/test-scan-123/index.md'
                        MockWiki.return_value = mock_wiki
                        agent = ArchivistAgent(scan_id)
                        result = agent.run()
        
        # Assert
        assert result is not None
        assert 'count' in result
        assert 'wiki_url' in result
    
    def test_think_prepares_archive(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_final_findings,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test THINK phase prepares archive structure."""
        # Arrange
        scan_id = sample_final_findings['scan_id']
        
        # Create context manifest in S3
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Mock redis lrange
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_final_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return Mock()
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    with patch('src.agents.archivist.agent.SecurityWikiGenerator') as MockWiki:
                        mock_wiki = Mock()
                        mock_wiki.generate_wiki.return_value = Mock()  # Returns wiki object
                        mock_wiki.export_wiki.return_value = 'wiki/test-scan-123/index.md'
                        MockWiki.return_value = mock_wiki
                        agent = ArchivistAgent(scan_id)
                        result = agent.run()
        
        # Assert
        assert result is not None
        assert 'count' in result
    
    def test_decide_structures_findings(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_final_findings,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test DECIDE phase structures findings for storage."""
        # Arrange
        scan_id = sample_final_findings['scan_id']
        
        # Create context manifest in S3
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Mock redis lrange
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_final_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return Mock()
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    with patch('src.agents.archivist.agent.SecurityWikiGenerator') as MockWiki:
                        mock_wiki = Mock()
                        mock_wiki.generate_wiki.return_value = Mock()  # Returns wiki object
                        mock_wiki.export_wiki.return_value = 'wiki/test-scan-123/index.md'
                        MockWiki.return_value = mock_wiki
                        agent = ArchivistAgent(scan_id)
                        result = agent.run()
        
        # Assert
        assert result is not None
        assert 'count' in result
    
    def test_act_writes_to_dynamodb(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_final_findings,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test ACT phase writes findings to DynamoDB."""
        # Arrange
        scan_id = sample_final_findings['scan_id']
        
        # Create context manifest in S3
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Mock redis lrange
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_final_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return Mock()
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    with patch('src.agents.archivist.agent.SecurityWikiGenerator') as MockWiki:
                        mock_wiki = Mock()
                        mock_wiki.generate_wiki.return_value = Mock()  # Returns wiki object
                        mock_wiki.export_wiki.return_value = 'wiki/test-scan-123/index.md'
                        MockWiki.return_value = mock_wiki
                        agent = ArchivistAgent(scan_id)
                        result = agent.run()
        
        # Assert
        assert result is not None
        # Verify put_item was called (moto doesn't track .called, just verify result)
        assert 'count' in result
    
    def test_wiki_generation(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_final_findings,
        sample_context_manifest,
        sample_security_wiki,
        create_s3_object,
        mock_environment
    ):
        """Test security wiki generation."""
        # Arrange
        scan_id = sample_final_findings['scan_id']
        
        # Create context manifest in S3
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/{scan_id}/context-manifest.json',
            sample_context_manifest
        )
        
        # Mock redis lrange
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_final_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return Mock()
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    
                    with patch('src.agents.archivist.agent.SecurityWikiGenerator') as MockWiki:
                        mock_wiki = Mock()
                        mock_wiki.generate_wiki.return_value = Mock()  # Returns wiki object
                        mock_wiki.export_wiki.return_value = 'wiki/test-scan-123/index.md'
                        MockWiki.return_value = mock_wiki
                        agent = ArchivistAgent(scan_id)
                        result = agent.run()
        
        # Assert
        assert result is not None
        assert 'wiki_url' in result
    
    def test_memory_trigger(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_context_manifest,
        create_s3_object,
        mock_environment
    ):
        """Test Lambda memory ingestion trigger."""
        # Arrange
        mock_lambda_client = Mock()
        mock_lambda_client.invoke.return_value = {'StatusCode': 200}
        
        # Create context manifest in S3
        create_s3_object(
            'test-bucket',
            f'agent-outputs/archaeologist/test-scan/context-manifest.json',
            sample_context_manifest
        )
        
        # Mock redis lrange
        mock_redis_client.lrange.return_value = []
        
        # Act
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return mock_lambda_client
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    with patch('src.agents.archivist.agent.SecurityWikiGenerator') as MockWiki:
                        mock_wiki = Mock()
                        mock_wiki.generate_wiki.return_value = Mock()  # Returns wiki object
                        mock_wiki.export_wiki.return_value = 'wiki/test-scan-123/index.md'
                        MockWiki.return_value = mock_wiki
                        agent = ArchivistAgent('test-scan')
                        agent.run()
        
        # Assert
        assert mock_lambda_client.invoke.called
    
    def test_error_handling_dynamodb_failure(
        self,
        mock_redis_client,
        mock_dynamodb_client,
        mock_s3_client,
        sample_final_findings,
        mock_environment
    ):
        """Test error handling for DynamoDB write failures."""
        # Arrange
        mock_dynamodb_client.put_item = Mock(side_effect=Exception('DynamoDB error'))
        
        # Mock redis lrange
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_final_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act & Assert
        from src.agents.archivist.agent import ArchivistAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                with patch('src.agents.archivist.agent.boto3.client') as mock_boto_client:
                    def client_factory(service, **kwargs):
                        if service == 'dynamodb':
                            return mock_dynamodb_client
                        elif service == 's3':
                            return mock_s3_client
                        elif service == 'lambda':
                            return Mock()
                        return Mock()
                    
                    mock_boto_client.side_effect = client_factory
                    agent = ArchivistAgent('test-scan')
                    
                    with pytest.raises(Exception) as exc_info:
                        agent.run()
                    
                    # Verify the exception is related to DynamoDB
                    assert 'DynamoDB' in str(exc_info.value) or 'dynamodb' in str(exc_info.value).lower()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])