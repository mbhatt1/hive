"""
Unit Tests for Bedrock Client (Cognitive Kernel)
=================================================

Tests the secure interface to Amazon Bedrock for agent cognition.
"""

import pytest
import json
import asyncio
from unittest.mock import Mock, patch, MagicMock, AsyncMock
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
    
    @patch('boto3.client')
    def test_invoke_claude_with_max_tokens(self, mock_boto_client):
        """Test Claude invocation with max_tokens parameter."""
        mock_response = {
            'body': Mock(read=lambda: json.dumps({
                'content': [{'type': 'text', 'text': 'Response'}],
                'stop_reason': 'max_tokens',
                'usage': {'input_tokens': 10, 'output_tokens': 1000}
            }).encode())
        }
        
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(return_value=mock_response)
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        response = kernel.invoke_claude(
            system_prompt='System',
            user_prompt='User',
            max_tokens=1000
        )
        
        assert response.stop_reason == 'max_tokens'
        assert response.usage['output_tokens'] == 1000
    
    @patch('boto3.client')
    def test_invoke_claude_with_temperature(self, mock_boto_client):
        """Test Claude invocation with temperature parameter."""
        mock_response = {
            'body': Mock(read=lambda: json.dumps({
                'content': [{'type': 'text', 'text': 'Creative response'}],
                'stop_reason': 'end_turn',
                'usage': {'input_tokens': 10, 'output_tokens': 20}
            }).encode())
        }
        
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(return_value=mock_response)
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        response = kernel.invoke_claude(
            system_prompt='Be creative',
            user_prompt='Write a story',
            temperature=0.9
        )
        
        assert response.content == 'Creative response'
    
    def test_bedrock_response_initialization(self):
        """Test BedrockResponse dataclass."""
        response = BedrockResponse(
            content='Test content',
            stop_reason='end_turn',
            usage={'input_tokens': 10, 'output_tokens': 5},
            model_id='anthropic.claude-sonnet-4-20250514-v1:0'
        )
        
        assert response.content == 'Test content'
        assert response.stop_reason == 'end_turn'
        assert response.usage['input_tokens'] == 10
        assert response.model_id == 'anthropic.claude-sonnet-4-20250514-v1:0'
    
    def test_kendra_context_initialization(self):
        """Test KendraContext dataclass."""
        context = KendraContext(
            documents=[{'title': 'Doc 1', 'excerpt': 'Content 1'}],
            query='test query',
            total_results=1
        )
        
        assert len(context.documents) == 1
        assert context.query == 'test query'
        assert context.total_results == 1
    
    @patch('boto3.client')
    def test_retrieve_from_kendra_no_results(self, mock_boto_client):
        """Test Kendra retrieval with no results."""
        mock_kendra_response = {'ResultItems': []}
        
        mock_kendra = Mock()
        mock_kendra.retrieve = Mock(return_value=mock_kendra_response)
        mock_boto_client.return_value = mock_kendra
        
        kernel = CognitiveKernel(kendra_index_id='test-index')
        context = kernel.retrieve_from_kendra('query with no results')
        
        assert context.total_results == 0
        assert len(context.documents) == 0
    
    @patch('boto3.client')
    def test_retrieve_from_kendra_with_attributes(self, mock_boto_client):
        """Test Kendra retrieval with document attributes."""
        mock_kendra_response = {
            'ResultItems': [
                {
                    'Id': 'doc1',
                    'DocumentTitle': 'Test Doc',
                    'Content': 'Content',
                    'DocumentURI': 's3://bucket/doc',
                    'ScoreAttributes': {'ScoreConfidence': 'MEDIUM'},
                    'DocumentAttributes': [
                        {'Key': '_source_uri', 'Value': {'StringValue': 'https://example.com'}}
                    ]
                }
            ]
        }
        
        mock_kendra = Mock()
        mock_kendra.retrieve = Mock(return_value=mock_kendra_response)
        mock_boto_client.return_value = mock_kendra
        
        kernel = CognitiveKernel(kendra_index_id='test-index')
        context = kernel.retrieve_from_kendra('query')
        
        assert context.total_results == 1
        assert context.documents[0]['score'] == 'MEDIUM'
        assert len(context.documents[0]['attributes']) == 1
    
    @patch('boto3.client')
    def test_generate_embeddings_error(self, mock_boto_client):
        """Test embedding generation error handling."""
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(side_effect=Exception('Embedding error'))
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        
        with pytest.raises(RuntimeError, match='Embedding generation failed'):
            kernel.generate_embeddings('test text')
    
    def test_sanitize_input_empty_string(self):
        """Test sanitizing empty string."""
        kernel = CognitiveKernel()
        
        result = kernel._sanitize_input('')
        assert result == ''
    
    def test_sanitize_input_with_special_characters(self):
        """Test sanitizing input with special characters."""
        kernel = CognitiveKernel()
        
        text_with_special = 'Text with <tags> and & symbols'
        result = kernel._sanitize_input(text_with_special)
        assert result == text_with_special  # Should preserve special chars
    
    def test_compute_hash_consistency(self):
        """Test hash computation is consistent."""
        kernel = CognitiveKernel()
        
        # Same input should always produce same hash
        hash1 = kernel._compute_hash('consistent input')
        hash2 = kernel._compute_hash('consistent input')
        hash3 = kernel._compute_hash('consistent input')
        
        assert hash1 == hash2 == hash3
    
    def test_format_kendra_context_empty(self):
        """Test formatting empty Kendra context."""
        kernel = CognitiveKernel()
        
        context = KendraContext(documents=[], query='', total_results=0)
        formatted = kernel._format_kendra_context(context)
        
        assert formatted == ''  # Or appropriate empty format
    
    @patch('boto3.client')
    def test_invoke_with_rag_no_results(self, mock_boto_client):
        """Test RAG invocation when Kendra returns no results."""
        mock_kendra_response = {'ResultItems': []}
        mock_bedrock_response = {
            'body': Mock(read=lambda: json.dumps({
                'content': [{'type': 'text', 'text': 'Response without context'}],
                'stop_reason': 'end_turn',
                'usage': {'input_tokens': 50, 'output_tokens': 10}
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
            query='query with no results',
            system_prompt='System',
            user_prompt_template='Context: {context}\n\nAnalyze.'
        )
        
        assert isinstance(response, BedrockResponse)
    
    @patch('boto3.client')
    def test_bedrock_throttling(self, mock_boto_client):
        """Test handling of Bedrock throttling errors."""
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(side_effect=Exception('ThrottlingException'))
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        
        with pytest.raises(RuntimeError, match='Bedrock invocation failed'):
            kernel.invoke_claude(system_prompt='System', user_prompt='User')
    
    @patch('boto3.client')
    def test_kendra_retrieval_error(self, mock_boto_client):
        """Test handling of Kendra retrieval errors."""
        mock_kendra = Mock()
        mock_kendra.retrieve = Mock(side_effect=Exception('Kendra error'))
        mock_boto_client.return_value = mock_kendra
        
        kernel = CognitiveKernel(kendra_index_id='test-index')
        
        with pytest.raises(RuntimeError, match='Kendra retrieval failed'):
            kernel.retrieve_from_kendra('query')
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_list_mcp_tools(self, mock_registry_class):
        """Test listing MCP tools."""
        mock_registry = AsyncMock()
        mock_registry.list_all_tools = AsyncMock(return_value={
            'semgrep-mcp': [{'name': 'semgrep_scan', 'description': 'Scan code'}],
            'gitleaks-mcp': [{'name': 'gitleaks_scan', 'description': 'Find secrets'}]
        })
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        tools = await kernel.list_mcp_tools()
        
        assert 'semgrep-mcp' in tools
        assert 'gitleaks-mcp' in tools
        assert len(tools['semgrep-mcp']) == 1
        mock_registry.list_all_tools.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_list_mcp_tools_not_enabled(self):
        """Test listing MCP tools when not enabled."""
        kernel = CognitiveKernel()
        kernel.mcp_registry = None
        
        with pytest.raises(RuntimeError, match='MCP tools not enabled'):
            await kernel.list_mcp_tools()
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_list_mcp_tools_error(self, mock_registry_class):
        """Test error handling when listing MCP tools."""
        mock_registry = AsyncMock()
        mock_registry.list_all_tools = AsyncMock(side_effect=Exception('Connection error'))
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        with pytest.raises(Exception, match='Connection error'):
            await kernel.list_mcp_tools()
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_invoke_mcp_tool(self, mock_registry_class):
        """Test invoking an MCP tool."""
        mock_registry = AsyncMock()
        mock_registry.call_tool = AsyncMock(return_value={
            'success': True,
            'result': {'vulnerabilities': ['CVE-2021-1234']},
            'output': 'Scan complete'
        })
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        result = await kernel.invoke_mcp_tool(
            server_name='semgrep-mcp',
            tool_name='semgrep_scan',
            arguments={'source_path': '/tmp/code'}
        )
        
        assert result['success'] is True
        assert 'vulnerabilities' in result['result']
        mock_registry.call_tool.assert_called_once()
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_invoke_mcp_tool_with_env(self, mock_registry_class):
        """Test invoking MCP tool with additional environment variables."""
        mock_registry = AsyncMock()
        mock_registry.call_tool = AsyncMock(return_value={'success': True})
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        result = await kernel.invoke_mcp_tool(
            server_name='semgrep-mcp',
            tool_name='semgrep_scan',
            arguments={'source_path': '/tmp/code'},
            additional_env={'CUSTOM_VAR': 'value'}
        )
        
        assert result['success'] is True
        call_args = mock_registry.call_tool.call_args
        assert call_args.kwargs['env'] == {'CUSTOM_VAR': 'value'}
    
    @pytest.mark.asyncio
    async def test_invoke_mcp_tool_not_enabled(self):
        """Test invoking MCP tool when not enabled."""
        kernel = CognitiveKernel()
        kernel.mcp_registry = None
        
        with pytest.raises(RuntimeError, match='MCP tools not enabled'):
            await kernel.invoke_mcp_tool('semgrep-mcp', 'scan', {})
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_invoke_mcp_tool_failure(self, mock_registry_class):
        """Test MCP tool invocation failure."""
        mock_registry = AsyncMock()
        mock_registry.call_tool = AsyncMock(return_value={
            'success': False,
            'error': 'Tool execution failed'
        })
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        result = await kernel.invoke_mcp_tool(
            server_name='semgrep-mcp',
            tool_name='semgrep_scan',
            arguments={'source_path': '/tmp/code'}
        )
        
        assert result['success'] is False
        assert 'error' in result
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_invoke_mcp_tool_exception(self, mock_registry_class):
        """Test MCP tool invocation with exception."""
        mock_registry = AsyncMock()
        mock_registry.call_tool = AsyncMock(side_effect=Exception('Connection lost'))
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        result = await kernel.invoke_mcp_tool(
            server_name='semgrep-mcp',
            tool_name='semgrep_scan',
            arguments={'source_path': '/tmp/code'}
        )
        
        assert result['success'] is False
        assert 'Connection lost' in result['error']
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_invoke_mcp_tools_parallel(self, mock_registry_class):
        """Test parallel MCP tool invocation."""
        mock_registry = AsyncMock()
        
        async def mock_call_tool(server_name, tool_name, arguments, env=None):
            await asyncio.sleep(0.01)  # Simulate async work
            return {
                'success': True,
                'server': server_name,
                'tool': tool_name,
                'result': f'Scan complete for {server_name}'
            }
        
        mock_registry.call_tool = mock_call_tool
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        tool_invocations = [
            {
                'server_name': 'semgrep-mcp',
                'tool_name': 'semgrep_scan',
                'arguments': {'source_path': '/tmp/code'}
            },
            {
                'server_name': 'gitleaks-mcp',
                'tool_name': 'gitleaks_scan',
                'arguments': {'source_path': '/tmp/code'}
            },
            {
                'server_name': 'trivy-mcp',
                'tool_name': 'trivy_scan',
                'arguments': {'source_path': '/tmp/code'}
            }
        ]
        
        results = await kernel.invoke_mcp_tools_parallel(tool_invocations, max_concurrency=2)
        
        assert len(results) == 3
        assert all(r['success'] for r in results)
        assert results[0]['server'] == 'semgrep-mcp'
        assert results[1]['server'] == 'gitleaks-mcp'
        assert results[2]['server'] == 'trivy-mcp'
    
    @pytest.mark.asyncio
    async def test_invoke_mcp_tools_parallel_not_enabled(self):
        """Test parallel MCP tool invocation when not enabled."""
        kernel = CognitiveKernel()
        kernel.mcp_registry = None
        
        with pytest.raises(RuntimeError, match='MCP tools not enabled'):
            await kernel.invoke_mcp_tools_parallel([])
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_invoke_mcp_tools_parallel_with_failures(self, mock_registry_class):
        """Test parallel MCP tool invocation with some failures."""
        mock_registry = AsyncMock()
        
        call_count = [0]
        
        async def mock_call_tool(server_name, tool_name, arguments, env=None):
            call_count[0] += 1
            if call_count[0] == 2:
                raise Exception('Tool 2 failed')
            return {'success': True, 'server': server_name}
        
        mock_registry.call_tool = mock_call_tool
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        tool_invocations = [
            {'server_name': 'tool1', 'tool_name': 'scan', 'arguments': {}},
            {'server_name': 'tool2', 'tool_name': 'scan', 'arguments': {}},
            {'server_name': 'tool3', 'tool_name': 'scan', 'arguments': {}}
        ]
        
        results = await kernel.invoke_mcp_tools_parallel(tool_invocations)
        
        assert len(results) == 3
        assert results[0]['success'] is True
        assert results[1]['success'] is False
        assert 'Tool 2 failed' in results[1]['error']
        assert results[2]['success'] is True
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_cleanup_mcp_connections(self, mock_registry_class):
        """Test MCP connection cleanup."""
        mock_registry = AsyncMock()
        mock_registry.disconnect_all = AsyncMock()
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        await kernel.cleanup_mcp_connections()
        
        mock_registry.disconnect_all.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_cleanup_mcp_connections_no_registry(self):
        """Test cleanup when no MCP registry exists."""
        kernel = CognitiveKernel()
        kernel.mcp_registry = None
        
        # Should not raise exception
        await kernel.cleanup_mcp_connections()
    
    @pytest.mark.asyncio
    @patch('src.shared.cognitive_kernel.bedrock_client.MCPToolRegistry')
    async def test_cleanup_mcp_connections_error(self, mock_registry_class):
        """Test MCP cleanup error handling."""
        mock_registry = AsyncMock()
        mock_registry.disconnect_all = AsyncMock(side_effect=Exception('Cleanup error'))
        mock_registry_class.return_value = mock_registry
        
        kernel = CognitiveKernel()
        kernel.mcp_registry = mock_registry
        
        # Should log warning but not raise
        await kernel.cleanup_mcp_connections()
        
        mock_registry.disconnect_all.assert_called_once()
    
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
    
    @patch('boto3.client')
    def test_generate_embeddings_error(self, mock_boto_client):
        """Test embedding generation error."""
        mock_bedrock = Mock()
        mock_bedrock.invoke_model = Mock(side_effect=Exception('Embedding error'))
        mock_boto_client.return_value = mock_bedrock
        
        kernel = CognitiveKernel()
        
        with pytest.raises(RuntimeError, match='Embedding generation failed'):
            kernel.generate_embeddings('test text')
    
    def test_format_kendra_context_with_documents(self):
        """Test formatting Kendra context with documents."""
        kernel = CognitiveKernel()
        
        context = KendraContext(
            documents=[
                {
                    'title': 'Doc 1',
                    'excerpt': 'Content 1',
                    'uri': 's3://bucket/doc1',
                    'score': 'HIGH'
                },
                {
                    'title': 'Doc 2',
                    'excerpt': 'Content 2',
                    'uri': 's3://bucket/doc2',
                    'score': 'MEDIUM'
                }
            ],
            query='test query',
            total_results=2
        )
        
        formatted = kernel._format_kendra_context(context)
        
        assert 'Doc 1' in formatted or 'Content 1' in formatted
        assert len(formatted) > 0
    
    def test_format_kendra_context_empty(self):
        """Test formatting empty Kendra context."""
        kernel = CognitiveKernel()
        
        context = KendraContext(documents=[], query='test', total_results=0)
        formatted = kernel._format_kendra_context(context)
        
        # Should return empty string or appropriate message
        assert isinstance(formatted, str)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])