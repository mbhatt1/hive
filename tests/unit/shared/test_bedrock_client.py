"""
Unit Tests for Bedrock Client (Cognitive Kernel)
=================================================

Tests the secure interface to Amazon Bedrock for agent cognition.
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from src.shared.cognitive_kernel.bedrock_client import (
    CognitiveKernel,
    BedrockResponse,
    KendraContext
)


@pytest.mark.shared
@pytest.mark.unit
class TestCognitiveKernel:
    """Test suite for CognitiveKernel (BedrockClient)."""
    
    def test_initialization(self):
        """Test CognitiveKernel initialization."""
        kernel = CognitiveKernel(
            region='us-east-1',
            model_id='anthropic.claude-sonnet-4-20250514-v1:0'
        )
        
        assert kernel.model_id == 'anthropic.claude-sonnet-4-20250514-v1:0'
        assert kernel.bedrock_runtime is not None
    
    def test_initialization_with_kendra(self):
        """Test initialization with Kendra index."""
        kernel = CognitiveKernel(
            region='us-east-1',
            model_id='anthropic.claude-sonnet-4-20250514-v1:0',
            kendra_index_id='test-index-123'
        )
        
        assert kernel.kendra_index_id == 'test-index-123'
        assert kernel.kendra_client is not None
    
    @patch('boto3.client')
    def test_invoke_claude(self, mock_boto_client):
        """Test Claude invocation."""
        # Mock Bedrock response
        mock_response = {
            'body': Mock(read=lambda: json.dumps({
                'content': [
                    {'type': 'text', 'text': 'This is a test response'}
                ],
                'stop_reason': 'end_turn',
                'usage': {'input_tokens': 10, 'output_tokens': 5}
            }).encode())
        }
        
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(return_value=mock_response)
        mock_boto_client.return_value = mock_bedrock
        
        # Act
        kernel = CognitiveKernel()
        response = kernel.invoke_claude(
            system_prompt='You are a helpful assistant',
            user_prompt='What is 2+2?'
        )
        
        # Assert
        assert isinstance(response, BedrockResponse)
        assert response.content == 'This is a test response'
        assert response.stop_reason == 'end_turn'
        assert response.usage['input_tokens'] == 10
    
    @patch('boto3.client')
    def test_invoke_claude_with_tools(self, mock_boto_client):
        """Test Claude invocation with tool definitions."""
        mock_response = {
            'body': Mock(read=lambda: json.dumps({
                'content': [{'type': 'text', 'text': 'Tool response'}],
                'stop_reason': 'tool_use',
                'usage': {'input_tokens': 20, 'output_tokens': 10}
            }).encode())
        }
        
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(return_value=mock_response)
        mock_boto_client.return_value = mock_bedrock
        
        tools = [{
            'name': 'get_weather',
            'description': 'Get weather for a location',
            'input_schema': {
                'type': 'object',
                'properties': {'location': {'type': 'string'}}
            }
        }]
        
        kernel = CognitiveKernel()
        response = kernel.invoke_claude(
            system_prompt='System',
            user_prompt='User',
            tools=tools
        )
        
        assert response.stop_reason == 'tool_use'
    
    @patch('boto3.client')
    def test_retrieve_from_kendra(self, mock_boto_client):
        """Test Kendra retrieval."""
        mock_kendra_response = {
            'ResultItems': [
                {
                    'Id': 'doc1',
                    'DocumentTitle': 'Test Document',
                    'Content': 'This is test content',
                    'DocumentURI': 's3://bucket/doc1',
                    'ScoreAttributes': {'ScoreConfidence': 'HIGH'},
                    'DocumentAttributes': []
                }
            ]
        }
        
        mock_kendra = Mock()
        mock_kendra.retrieve = Mock(return_value=mock_kendra_response)
        mock_boto_client.return_value = mock_kendra
        
        kernel = CognitiveKernel(kendra_index_id='test-index')
        context = kernel.retrieve_from_kendra('test query', top_k=5)
        
        assert isinstance(context, KendraContext)
        assert context.query == 'test query'
        assert context.total_results == 1
        assert len(context.documents) == 1
        assert context.documents[0]['title'] == 'Test Document'
    
    @patch('boto3.client')
    def test_invoke_with_rag(self, mock_boto_client):
        """Test RAG-augmented invocation."""
        # Mock Kendra
        mock_kendra_response = {
            'ResultItems': [{
                'Id': 'doc1',
                'DocumentTitle': 'Security Finding',
                'Content': 'SQL injection detected',
                'DocumentURI': 's3://bucket/finding',
                'ScoreAttributes': {'ScoreConfidence': 'HIGH'},
                'DocumentAttributes': []
            }]
        }
        
        # Mock Bedrock
        mock_bedrock_response = {
            'body': Mock(read=lambda: json.dumps({
                'content': [{'type': 'text', 'text': 'RAG response'}],
                'stop_reason': 'end_turn',
                'usage': {'input_tokens': 100, 'output_tokens': 50}
            }).encode())
        }
        
        mock_clients = {
            'kendra': Mock(retrieve=Mock(return_value=mock_kendra_response)),
            'bedrock-runtime': Mock(invoke_model=Mock(return_value=mock_bedrock_response))
        }
        
        def client_factory(service, **kwargs):
            return mock_clients.get(service)
        
        mock_boto_client.side_effect = client_factory
        
        kernel = CognitiveKernel(kendra_index_id='test-index')
        response = kernel.invoke_with_rag(
            query='SQL injection',
            system_prompt='Analyze findings',
            user_prompt_template='Context: {context}\n\nAnalyze this.',
            top_k=3
        )
        
        assert isinstance(response, BedrockResponse)
        assert response.content == 'RAG response'
    
    @patch('boto3.client')
    def test_generate_embeddings(self, mock_boto_client):
        """Test embedding generation."""
        mock_response = {
            'body': Mock(read=lambda: json.dumps({
                'embedding': [0.1, 0.2, 0.3, 0.4, 0.5]
            }).encode())
        }
        
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(return_value=mock_response)
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        embeddings = kernel.generate_embeddings('test text')
        
        assert len(embeddings) == 5
        assert embeddings == [0.1, 0.2, 0.3, 0.4, 0.5]
    
    def test_sanitize_input(self):
        """Test input sanitization."""
        kernel = CognitiveKernel()
        
        # Test normal input
        result = kernel._sanitize_input('normal text')
        assert result == 'normal text'
        
        # Test truncation
        long_text = 'a' * 200000
        result = kernel._sanitize_input(long_text, max_length=1000)
        assert len(result) == 1000
    
    def test_sanitize_input_invalid(self):
        """Test sanitization rejects non-string."""
        kernel = CognitiveKernel()
        
        with pytest.raises(ValueError, match='Input must be string'):
            kernel._sanitize_input(123)
    
    def test_compute_hash(self):
        """Test hash computation for audit."""
        kernel = CognitiveKernel()
        
        hash1 = kernel._compute_hash('test content')
        hash2 = kernel._compute_hash('test content')
        hash3 = kernel._compute_hash('different')
        
        assert hash1 == hash2
        assert hash1 != hash3
        assert len(hash1) == 16  # truncated to 16 chars
    
    def test_format_kendra_context(self):
        """Test Kendra context formatting."""
        kernel = CognitiveKernel()
        
        context = KendraContext(
            documents=[
                {
                    'title': 'Doc 1',
                    'excerpt': 'This is document 1 content',
                    'uri': 's3://bucket/doc1'
                },
                {
                    'title': 'Doc 2',
                    'excerpt': 'This is document 2 content',
                    'uri': 's3://bucket/doc2'
                }
            ],
            query='test query',
            total_results=2
        )
        
        formatted = kernel._format_kendra_context(context)
        
        assert 'Document 1:' in formatted
        assert 'Document 2:' in formatted
        assert 'Doc 1' in formatted
        assert 'Doc 2' in formatted
    
    @patch('boto3.client')
    def test_error_handling_bedrock_failure(self, mock_boto_client):
        """Test error handling when Bedrock fails."""
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(side_effect=Exception('Bedrock error'))
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        
        with pytest.raises(RuntimeError, match='Bedrock invocation failed'):
            kernel.invoke_claude(
                system_prompt='System',
                user_prompt='User'
            )
    
    @patch('boto3.client')
    def test_error_handling_kendra_not_configured(self, mock_boto_client):
        """Test error when Kendra not configured."""
        kernel = CognitiveKernel()  # No Kendra index
        
        with pytest.raises(ValueError, match='Kendra not configured'):
            kernel.retrieve_from_kendra('query')
    
    @patch('boto3.client')
    def test_error_handling_rag_without_kendra(self, mock_boto_client):
        """Test RAG fails without Kendra."""
        kernel = CognitiveKernel()  # No Kendra
        
        with pytest.raises(ValueError, match='Kendra not configured for RAG'):
            kernel.invoke_with_rag(
                query='test',
                system_prompt='system',
                user_prompt_template='template {context}'
            )


if __name__ == '__main__':
    pytest.main([__file__, '-v'])