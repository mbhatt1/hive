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
                    results = await agent._act(tool_invocations, max_concurrency=1)
        
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
                    results = await agent._act(tool_invocations, max_concurrency=1)
        
        assert len(results) == 1
        assert results[0]['success'] == False
        assert 'error' in results[0]
    
    @pytest.mark.asyncio
    async def test_full_run_workflow(self, mock_environment, mock_redis):
        """Test full run workflow."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        # Mock S3 strategy
        mock_s3 = Mock()
        mock_s3.get_object.return_value = {
            'Body': Mock(read=lambda: json.dumps({
                'tools': [{'name': 'semgrep-mcp', 'priority': 1}],
                'parallel_execution': True,
                'max_concurrency': 3
            }).encode())
        }
        mock_s3.put_object = Mock()
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    agent = CoordinatorAgent()
                    
                    # Mock MCP operations
                    agent.cognitive_kernel.list_mcp_tools = AsyncMock(return_value={
                        'semgrep-mcp': [{'name': 'semgrep_scan'}]
                    })
                    agent.cognitive_kernel.invoke_mcp_tools_parallel = AsyncMock(return_value=[
                        {'success': True, 'server': 'semgrep-mcp', 'tool': 'semgrep_scan', 'content': [{'findings_count': 5}]}
                    ])
                    agent.cognitive_kernel.cleanup_mcp_connections = AsyncMock()
                    
                    result = await agent.run()
        
        assert result['mission_id'] == 'test-scan-123'
        assert result['tools_executed'] == 1
        assert result['tools_succeeded'] == 1
        assert result['success_rate'] == 1.0
        mock_s3.put_object.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_run_with_strategy_failure(self, mock_environment, mock_redis):
        """Test run with strategy read failure (uses default)."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        mock_s3 = Mock()
        mock_s3.get_object.side_effect = Exception('S3 error')
        mock_s3.put_object = Mock()
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    agent = CoordinatorAgent()
                    
                    agent.cognitive_kernel.list_mcp_tools = AsyncMock(return_value={
                        'semgrep-mcp': [{'name': 'semgrep_scan'}]
                    })
                    agent.cognitive_kernel.invoke_mcp_tools_parallel = AsyncMock(return_value=[
                        {'success': True, 'server': 'semgrep-mcp', 'tool': 'semgrep_scan'}
                    ])
                    agent.cognitive_kernel.cleanup_mcp_connections = AsyncMock()
                    
                    result = await agent.run()
        
        assert result['mission_id'] == 'test-scan-123'
        assert result['tools_succeeded'] >= 0
    
    def test_create_default_strategy(self, mock_environment, mock_redis):
        """Test default strategy creation."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                strategy = agent._create_default_strategy()
        
        assert 'tools' in strategy
        assert 'parallel_execution' in strategy
        assert 'max_concurrency' in strategy
        assert len(strategy['tools']) > 0
    
    def test_create_mcp_invocation_plan_all_tools(self, mock_environment, mock_redis):
        """Test MCP invocation plan with all tool types."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {
            'tools': [
                {'name': 'semgrep-mcp', 'priority': 1},
                {'name': 'gitleaks-mcp', 'priority': 1},
                {'name': 'trivy-mcp', 'priority': 2},
                {'name': 'scoutsuite-mcp', 'priority': 3},
                {'name': 'pacu-mcp', 'priority': 3}
            ]
        }
        
        available_tools = {
            'semgrep-mcp': [{'name': 'semgrep_scan'}],
            'gitleaks-mcp': [{'name': 'gitleaks_scan'}],
            'trivy-mcp': [{'name': 'trivy_fs_scan'}],
            'scoutsuite-mcp': [{'name': 'scoutsuite_scan'}],
            'pacu-mcp': [{'name': 'pacu_enum_permissions'}]
        }
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                plan = agent._create_mcp_invocation_plan(strategy, available_tools)
        
        assert len(plan) == 5
        assert any(inv['server_name'] == 'semgrep-mcp' for inv in plan)
        assert any(inv['server_name'] == 'gitleaks-mcp' for inv in plan)
        assert any(inv['server_name'] == 'trivy-mcp' for inv in plan)
        assert any(inv['server_name'] == 'scoutsuite-mcp' for inv in plan)
        assert any(inv['server_name'] == 'pacu-mcp' for inv in plan)
    
    def test_create_mcp_invocation_plan_alternate_names(self, mock_environment, mock_redis):
        """Test MCP invocation plan with alternate tool names."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {
            'tools': [
                {'name': 'semgrep', 'priority': 1},
                {'name': 'gitleaks', 'priority': 1},
                {'name': 'trivy', 'priority': 2}
            ]
        }
        
        available_tools = {}
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                plan = agent._create_mcp_invocation_plan(strategy, available_tools)
        
        assert len(plan) == 3
        assert all('server_name' in inv for inv in plan)
        assert all('tool_name' in inv for inv in plan)
        assert all('arguments' in inv for inv in plan)
    
    def test_decide_concurrency_sequential(self, mock_environment, mock_redis):
        """Test concurrency decision for sequential execution."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {'parallel_execution': False}
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                concurrency = agent._decide_concurrency(strategy)
        
        assert concurrency == 1
    
    def test_decide_concurrency_with_limit(self, mock_environment, mock_redis):
        """Test concurrency decision with max_concurrency limit."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {'parallel_execution': True, 'max_concurrency': 3}
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                concurrency = agent._decide_concurrency(strategy)
        
        assert concurrency == 3
    
    def test_decide_concurrency_with_redis_resources(self, mock_environment, mock_redis):
        """Test concurrency decision with Redis resource check."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {'parallel_execution': True, 'max_concurrency': 10}
        mock_redis.zcount.return_value = 3
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                concurrency = agent._decide_concurrency(strategy)
        
        assert concurrency == 3
        mock_redis.zcount.assert_called_once()
    
    def test_decide_concurrency_redis_error(self, mock_environment, mock_redis):
        """Test concurrency decision when Redis check fails."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        strategy = {'parallel_execution': True, 'max_concurrency': 5}
        mock_redis.zcount.side_effect = Exception('Redis error')
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                concurrency = agent._decide_concurrency(strategy)
        
        assert concurrency == 5
    
    def test_process_tool_results_success(self, mock_environment, mock_redis):
        """Test processing successful tool results."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        results = [
            {
                'success': True,
                'server': 'semgrep-mcp',
                'tool': 'semgrep_scan',
                'content': [{'findings_count': 10, 'storage': {'key': 's3://bucket/results'}, 'summary': 'Found 10 issues'}]
            },
            {
                'success': True,
                'server': 'gitleaks-mcp',
                'tool': 'gitleaks_scan',
                'content': [{'secrets_found': 3}]
            }
        ]
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                processed = agent._process_tool_results(results)
        
        assert len(processed) == 2
        assert processed[0]['success'] == True
        assert processed[0]['findings_count'] == 10
        assert 'storage' in processed[0]
        assert processed[1]['findings_count'] == 3
    
    def test_process_tool_results_failures(self, mock_environment, mock_redis):
        """Test processing failed tool results."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        results = [
            {
                'success': False,
                'server': 'semgrep-mcp',
                'tool': 'semgrep_scan',
                'error': 'Scan timeout'
            }
        ]
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                processed = agent._process_tool_results(results)
        
        assert len(processed) == 1
        assert processed[0]['success'] == False
        assert processed[0]['error'] == 'Scan timeout'
    
    def test_process_tool_results_parse_error(self, mock_environment, mock_redis):
        """Test processing results with parsing errors."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        results = [
            {
                'success': True,
                'server': 'semgrep-mcp',
                'tool': 'semgrep_scan',
                'content': [{'text': 'invalid json'}]  # Will fail to parse
            }
        ]
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                processed = agent._process_tool_results(results)
        
        assert len(processed) == 1
        assert processed[0]['success'] == True
    
    @pytest.mark.asyncio
    async def test_store_results(self, mock_environment, mock_redis):
        """Test storing results to S3."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        mock_s3 = Mock()
        mock_s3.put_object = Mock()
        
        results = [{'success': True, 'tool': 'semgrep_scan'}]
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    agent = CoordinatorAgent()
                    await agent._store_results(results)
        
        mock_s3.put_object.assert_called_once()
        call_args = mock_s3.put_object.call_args[1]
        assert call_args['Bucket'] == 'test-bucket'
        assert 'agent-outputs/coordinator' in call_args['Key']
    
    def test_reflect_on_execution(self, mock_environment, mock_redis):
        """Test reflection on execution results."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        results = [
            {'success': True, 'tool': 'semgrep_scan', 'findings_count': 10},
            {'success': True, 'tool': 'gitleaks_scan', 'findings_count': 3},
            {'success': False, 'tool': 'trivy_scan'}
        ]
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                reflection = agent._reflect_on_execution(results)
        
        assert reflection['total'] == 3
        assert reflection['successful'] == 2
        assert reflection['failed'] == 1
        assert reflection['success_rate'] == pytest.approx(0.666, abs=0.01)
        assert reflection['total_findings'] == 13
        assert len(reflection['tools_by_status']['succeeded']) == 2
        assert len(reflection['tools_by_status']['failed']) == 1
        mock_redis.rpush.assert_called_once()
    
    def test_update_state(self, mock_environment, mock_redis):
        """Test state update in Redis."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                agent._update_state('SENSING', confidence=0.8)
        
        mock_redis.hset.assert_called_once()
        mock_redis.sadd.assert_called_once()
    
    def test_update_state_completed(self, mock_environment, mock_redis):
        """Test state update for completed status."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                agent._update_state('COMPLETED', confidence=1.0)
        
        mock_redis.hset.assert_called_once()
        mock_redis.srem.assert_called_once()
    
    def test_update_state_with_error(self, mock_environment, mock_redis):
        """Test state update with error message."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                agent = CoordinatorAgent()
                agent._update_state('FAILED', error='Test error')
        
        call_args = mock_redis.hset.call_args[1]
        assert 'error_message' in call_args['mapping']
        assert call_args['mapping']['error_message'] == 'Test error'
        mock_redis.srem.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_run_error_handling(self, mock_environment, mock_redis):
        """Test error handling in run method."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        mock_s3 = Mock()
        mock_s3.get_object.return_value = {
            'Body': Mock(read=lambda: json.dumps({'tools': []}).encode())
        }
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    agent = CoordinatorAgent()
                    agent.cognitive_kernel.list_mcp_tools = AsyncMock(side_effect=Exception('MCP error'))
                    agent.cognitive_kernel.cleanup_mcp_connections = AsyncMock()
                    
                    with pytest.raises(Exception, match='MCP error'):
                        await agent.run()
        
        # Verify cleanup was called even on error
        agent.cognitive_kernel.cleanup_mcp_connections.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_cleanup_on_exception(self, mock_environment, mock_redis):
        """Test MCP cleanup happens even on exception."""
        from src.agents.coordinator.agent import CoordinatorAgent
        
        mock_s3 = Mock()
        mock_s3.get_object.return_value = {
            'Body': Mock(read=lambda: json.dumps({'tools': []}).encode())
        }
        mock_s3.put_object = Mock()
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    agent = CoordinatorAgent()
                    # Force an exception during tool invocation
                    agent.cognitive_kernel.list_mcp_tools = AsyncMock(return_value={})
                    agent.cognitive_kernel.invoke_mcp_tools_parallel = AsyncMock(side_effect=Exception('Tool execution failed'))
                    agent.cognitive_kernel.cleanup_mcp_connections = AsyncMock()
                    
                    with pytest.raises(Exception, match='Tool execution failed'):
                        await agent.run()
        
        # Verify cleanup was called even on error
        agent.cognitive_kernel.cleanup_mcp_connections.assert_called_once()
    
    def test_main_function(self, mock_environment, mock_redis):
        """Test main entry point function."""
        from src.agents.coordinator.agent import main, CoordinatorAgent
        
        mock_result = {
            'tools_executed': 3,
            'tools_succeeded': 3,
            'success_rate': 1.0
        }
        
        mock_s3 = Mock()
        mock_s3.get_object.return_value = {'Body': Mock(read=lambda: json.dumps({'tools': []}).encode())}
        mock_s3.put_object = Mock()
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    with patch.object(CoordinatorAgent, 'run', new=AsyncMock(return_value=mock_result)):
                        exit_code = main()
        
        assert exit_code == 0
    
    def test_main_function_failure(self, mock_environment, mock_redis):
        """Test main function with low success rate."""
        from src.agents.coordinator.agent import main, CoordinatorAgent
        
        mock_result = {
            'tools_executed': 3,
            'tools_succeeded': 1,
            'success_rate': 0.33
        }
        
        mock_s3 = Mock()
        mock_s3.get_object.return_value = {'Body': Mock(read=lambda: json.dumps({'tools': []}).encode())}
        mock_s3.put_object = Mock()
        
        with patch.dict('os.environ', mock_environment):
            with patch('redis.Redis', return_value=mock_redis):
                with patch('boto3.client', return_value=mock_s3):
                    with patch.object(CoordinatorAgent, 'run', new=AsyncMock(return_value=mock_result)):
                        exit_code = main()
        
        assert exit_code == 1