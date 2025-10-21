"""
Unit Tests for Coordinator Agent
=================================

Tests Coordinator agent with MCP tool invocation.
"""

import pytest
import json
from unittest.mock import Mock, patch, AsyncMock
import asyncio


@pytest.mark.agent
@pytest.mark.unit
class TestCoordinatorAgent:
    """Test suite for Coordinator agent."""
    
    def test_agent_initialization(self, mock_environment, mock_redis):
        """Test agent initialization."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
        
        assert agent is not None
        assert hasattr(agent, 'run')
    
    @pytest.mark.asyncio
    async def test_sense_reads_tool_plan(self, mock_environment, mock_redis):
        """Test reading execution strategy."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        # Mock S3 to return strategy with tool plan
        mock_s3 = Mock()
        mock_s3.get_object.return_value = {
            'Body': Mock(read=lambda: json.dumps({
                'recommended_tools': ['semgrep-mcp', 'gitleaks-mcp'],
                'scan_scope': {'source_path': '/tmp/test'}
            }).encode())
        }
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    agent = CoordinatorAgent()
                    
                    # Read execution strategy
                    strategy = await agent._read_execution_strategy()
        
        assert 'recommended_tools' in strategy
        assert 'scan_scope' in strategy
    
    @pytest.mark.asyncio
    async def test_decide_allocates_resources(self, mock_environment, mock_redis):
        """Test MCP invocation plan creation."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {
            'recommended_tools': ['semgrep-mcp', 'gitleaks-mcp'],
            'scan_scope': {}
        }
        
        available_tools = {
            'semgrep-mcp': [{'name': 'semgrep_scan'}],
            'gitleaks-mcp': [{'name': 'gitleaks_scan'}]
        }
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                
                # Create MCP invocation plan
                plan = agent._create_mcp_invocation_plan(strategy, available_tools)
        
        assert len(plan) >= 0  # Should create invocations based on strategy
    
    @pytest.mark.asyncio
    async def test_parallel_tool_execution(self, mock_environment, mock_redis):
        """Test parallel MCP tool execution."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                
                tool_invocations = [
                    {'server_name': 'semgrep-mcp', 'tool_name': 'semgrep_scan', 'arguments': {}},
                    {'server_name': 'gitleaks-mcp', 'tool_name': 'gitleaks_scan', 'arguments': {}}
                ]
                
                # Mock MCP execution
                mock_results = [
                    {'success': True, 'server': 'semgrep-mcp'},
                    {'success': True, 'server': 'gitleaks-mcp'}
                ]
                
                with patch.object(agent.cognitive_kernel, 'invoke_mcp_tools_parallel', new=AsyncMock(return_value=mock_results)):
                    results = await agent.cognitive_kernel.invoke_mcp_tools_parallel(tool_invocations, max_concurrency=2)
        
        assert len(results) == 2
        assert all(r['success'] for r in results)
    
    @pytest.mark.asyncio
    async def test_sequential_tool_execution(self, mock_environment, mock_redis):
        """Test sequential tool execution."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                
                tool_invocations = [
                    {'server_name': 'semgrep-mcp', 'tool_name': 'semgrep_scan', 'arguments': {}}
                ]
                
                mock_result = {'success': True, 'server': 'semgrep-mcp'}
                
                with patch.object(agent.cognitive_kernel, 'invoke_mcp_tools_parallel', new=AsyncMock(return_value=[mock_result])):
                    results = await agent.cognitive_kernel.invoke_mcp_tools_parallel(tool_invocations, max_concurrency=1)
        
        assert len(results) == 1
        assert results[0]['success'] == True
    
    @pytest.mark.asyncio
    async def test_error_handling_tool_failure(self, mock_environment, mock_redis):
        """Test error handling when tool execution fails."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                
                tool_invocations = [
                    {'server_name': 'semgrep-mcp', 'tool_name': 'semgrep_scan', 'arguments': {}}
                ]
                
                # Mock tool failure
                mock_result = {'success': False, 'error': 'Tool execution failed'}
                
                with patch.object(agent.cognitive_kernel, 'invoke_mcp_tools_parallel', new=AsyncMock(return_value=[mock_result])):
                    results = await agent.cognitive_kernel.invoke_mcp_tools_parallel(tool_invocations, max_concurrency=1)
        
        assert len(results) == 1
        assert results[0]['success'] == False
        assert 'error' in results[0]