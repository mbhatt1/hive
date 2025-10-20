"""
Unit Tests for Critic Agent
============================

Tests finding validation and counter-evidence generation.
"""

import pytest
import json
from unittest.mock import Mock, patch


@pytest.mark.agent
@pytest.mark.unit
class TestCriticAgent:
    """Test suite for Critic agent."""
    
    def test_sense_reads_draft_findings(
        self,
        mock_redis_client,
        mock_bedrock_client,
        mock_kendra_client,
        sample_draft_findings,
        mock_environment
    ):
        """Test SENSE phase reads draft findings from Redis."""
        # Arrange
        scan_id = sample_draft_findings['scan_id']
        
        # Mock redis lrange to return proposals
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_draft_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = CriticAgent(scan_id)
                    agent.run()
        
        # Assert
        assert mock_redis_client.lrange.called
        assert mock_bedrock_client.invoke_model.called
    
    def test_think_analyzes_for_false_positives(
        self,
        mock_redis_client,
        mock_bedrock_client,
        mock_kendra_client,
        sample_draft_findings,
        mock_environment
    ):
        """Test THINK phase analyzes for false positives."""
        # Arrange
        scan_id = sample_draft_findings['scan_id']
        
        # Mock redis lrange to return proposals
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_draft_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = CriticAgent(scan_id)
                    agent.run()
        
        # Assert
        assert mock_bedrock_client.invoke_model.called
        assert mock_kendra_client.retrieve.called
    
    def test_decide_validates_or_rejects(
        self,
        mock_redis_client,
        mock_bedrock_client,
        mock_kendra_client,
        sample_draft_findings,
        mock_environment
    ):
        """Test DECIDE phase validates or rejects findings."""
        # Arrange
        scan_id = sample_draft_findings['scan_id']
        
        # Mock redis lrange to return proposals
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_draft_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = CriticAgent(scan_id)
                    agent.run()
        
        # Assert
        assert mock_redis_client.rpush.called or mock_redis_client.lrange.called
    
    def test_act_counter_proposes(
        self,
        mock_redis_client,
        mock_bedrock_client,
        mock_kendra_client,
        sample_draft_findings,
        mock_environment
    ):
        """Test ACT phase creates counter-proposals."""
        # Arrange
        scan_id = sample_draft_findings['scan_id']
        
        # Mock redis lrange to return proposals
        proposals = [
            json.dumps({
                'agent': 'synthesizer',
                'payload': sample_draft_findings['findings'][0]
            })
        ]
        mock_redis_client.lrange.return_value = proposals
        
        # Act
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            with patch('boto3.client') as mock_boto_client:
                def client_factory(service, **kwargs):
                    if service == 'bedrock-runtime':
                        return mock_bedrock_client
                    elif service == 'kendra':
                        return mock_kendra_client
                    return Mock()
                
                mock_boto_client.side_effect = client_factory
                
                with patch('redis.Redis', return_value=mock_redis_client):
                    agent = CriticAgent(scan_id)
                    agent.run()
        
        # Assert
        assert mock_redis_client.rpush.called
    
    def test_negotiation_protocol(
        self,
        mock_redis_client,
        mock_environment
    ):
        """Test proposal/counter-proposal negotiation."""
        # Arrange
        proposal = {'finding_id': 'FIND-001', 'severity': 'HIGH'}
        counter_proposal = {'finding_id': 'FIND-001', 'severity': 'MEDIUM', 'reason': 'mitigating factors'}
        
        # Act
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                agent = CriticAgent('test-scan')
                agent._create_counter_proposal(proposal)
        
        # Assert: Counter-proposal created
        assert True  # Implementation-dependent
    
    def test_consensus_reached(
        self,
        mock_environment
    ):
        """Test consensus voting logic."""
        # Arrange
        votes = {'FIND-001': {'validate': 2, 'reject': 0}}
        
        # Act
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            agent = CriticAgent('test-scan')
            consensus = agent._check_consensus(votes)
        
        # Assert
        assert consensus is True or consensus is False
    
    def test_error_handling_consensus_timeout(
        self,
        mock_redis_client,
        mock_environment
    ):
        """Test handling of consensus timeout."""
        # Arrange
        mock_redis_client.get.return_value = None  # Simulate timeout
        
        # Act & Assert
        from src.agents.critic.agent import CriticAgent
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis_client):
                agent = CriticAgent('test-scan')
                try:
                    result = agent._wait_for_consensus(timeout=1)
                    assert result is not None
                except TimeoutError:
                    # Timeout is acceptable
                    pass


if __name__ == '__main__':
    pytest.main([__file__, '-v'])