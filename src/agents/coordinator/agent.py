"""
Coordinator Agent - MCP Tool Orchestration and Resource Allocation
Coordinates parallel MCP tool execution with resource management.
"""

import os
import json
import boto3
import redis
import logging
import asyncio
from typing import Dict, List, Any

from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class CoordinatorAgent:
    """
    Coordinator Agent with MCP protocol support.
    
    Implements async SENSE → THINK → DECIDE → ACT → REFLECT loop
    with direct MCP tool invocation.
    """
    
    def __init__(self, scan_id: str = None):
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'hivemind-artifacts')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        self.kendra_index_id = os.environ.get('KENDRA_INDEX_ID', 'test-index-123')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.redis_client = redis.Redis(
            host=self.redis_endpoint,
            port=self.redis_port,
            decode_responses=True
        )
        
        # Initialize cognitive kernel with MCP support
        self.cognitive_kernel = CognitiveKernel(
            region=region,
            kendra_index_id=self.kendra_index_id
        )
        
        logger.info(f"CoordinatorAgent initialized for mission: {self.mission_id} with MCP support")
    
    async def run(self) -> Dict[str, Any]:
        """
        Main async execution loop with MCP tool invocation.
        
        Returns:
            Dictionary with execution results
        """
        try:
            # SENSE: Read strategy and list available MCP tools
            self._update_state("SENSING")
            strategy = await self._read_execution_strategy()
            available_tools = await self.cognitive_kernel.list_mcp_tools()
            
            logger.info(f"Available MCP tools: {list(available_tools.keys())}")
            
            # THINK: Create MCP tool invocation plan
            self._update_state("THINKING")
            tool_invocations = self._create_mcp_invocation_plan(strategy, available_tools)
            
            # DECIDE: Determine parallel execution strategy
            self._update_state("DECIDING")
            max_concurrency = self._decide_concurrency(strategy)
            
            # ACT: Execute MCP tools in parallel
            self._update_state("ACTING")
            results = await self.cognitive_kernel.invoke_mcp_tools_parallel(
                tool_invocations,
                max_concurrency=max_concurrency
            )
            
            # Process and store results
            processed_results = self._process_tool_results(results)
            await self._store_results(processed_results)
            
            # REFLECT: Evaluate execution quality
            self._update_state("REFLECTING")
            reflection = self._reflect_on_execution(processed_results)
            
            # COMPLETED
            success_rate = reflection['success_rate']
            self._update_state("COMPLETED", confidence=success_rate)
            
            logger.info(f"CoordinatorAgent completed: {reflection['successful']}/{reflection['total']} tools succeeded")
            
            return {
                "mission_id": self.mission_id,
                "tools_executed": reflection['total'],
                "tools_succeeded": reflection['successful'],
                "success_rate": success_rate,
                "results": processed_results,
                "reflection": reflection
            }
            
        except Exception as e:
            logger.error(f"CoordinatorAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
            
        finally:
            # Always cleanup MCP connections
            try:
                await self.cognitive_kernel.cleanup_mcp_connections()
                logger.info("MCP connections cleaned up")
            except Exception as e:
                logger.warning(f"Error during MCP cleanup: {e}")
    
    async def _read_execution_strategy(self) -> Dict[str, Any]:
        """Read execution strategy from Strategist agent output."""
        try:
            key = f"agent-outputs/strategist/{self.mission_id}/execution-strategy.json"
            
            loop = asyncio.get_event_loop()
            obj = await loop.run_in_executor(
                None,
                self.s3_client.get_object,
                self.s3_artifacts_bucket,
                key
            )
            
            content = obj['Body'].read().decode()
            strategy = json.loads(content)
            
            logger.info(f"Loaded execution strategy with {len(strategy.get('tools', []))} tools")
            return strategy
            
        except Exception as e:
            logger.warning(f"Could not read strategy from S3: {e}, using default")
            # Return default strategy
            return self._create_default_strategy()
    
    def _create_default_strategy(self) -> Dict[str, Any]:
        """Create default execution strategy if Strategist output is unavailable."""
        return {
            "mission_id": self.mission_id,
            "tools": [
                {"name": "semgrep-mcp", "priority": 1},
                {"name": "gitleaks-mcp", "priority": 1},
                {"name": "trivy-mcp", "priority": 2}
            ],
            "parallel_execution": True,
            "max_concurrency": 5
        }
    
    def _create_mcp_invocation_plan(
        self,
        strategy: Dict[str, Any],
        available_tools: Dict[str, List[Dict]]
    ) -> List[Dict[str, Any]]:
        """
        Create MCP tool invocation plan from strategy.
        
        Args:
            strategy: Execution strategy from Strategist
            available_tools: Available MCP tools from registry
            
        Returns:
            List of tool invocation specifications
        """
        invocations = []
        source_path = f"unzipped/{self.mission_id}/"
        
        for tool_spec in strategy.get('tools', []):
            tool_name = tool_spec['name']
            
            # Map tool name to MCP server and tool
            if tool_name == 'semgrep-mcp' or tool_name == 'semgrep':
                invocations.append({
                    'server_name': 'semgrep-mcp',
                    'tool_name': 'semgrep_scan',
                    'arguments': {
                        'source_path': source_path,
                        'config': 'auto',
                        'timeout': 300
                    }
                })
            
            elif tool_name == 'gitleaks-mcp' or tool_name == 'gitleaks':
                invocations.append({
                    'server_name': 'gitleaks-mcp',
                    'tool_name': 'gitleaks_scan',
                    'arguments': {
                        'source_path': source_path,
                        'timeout': 180,
                        'no_git': True
                    }
                })
            
            elif tool_name == 'trivy-mcp' or tool_name == 'trivy':
                invocations.append({
                    'server_name': 'trivy-mcp',
                    'tool_name': 'trivy_fs_scan',
                    'arguments': {
                        'source_path': source_path,
                        'scan_type': 'vuln',
                        'severity': 'MEDIUM',
                        'timeout': 300
                    }
                })
            
            elif tool_name == 'scoutsuite-mcp' or tool_name == 'scoutsuite':
                invocations.append({
                    'server_name': 'scoutsuite-mcp',
                    'tool_name': 'scoutsuite_scan',
                    'arguments': {
                        'aws_profile': 'default',
                        'services': [],
                        'timeout': 1800
                    }
                })
            
            elif tool_name == 'pacu-mcp' or tool_name == 'pacu':
                # Use safe enumeration module
                invocations.append({
                    'server_name': 'pacu-mcp',
                    'tool_name': 'pacu_enum_permissions',
                    'arguments': {
                        'aws_profile': 'default'
                    }
                })
        
        logger.info(f"Created MCP invocation plan with {len(invocations)} tools")
        return invocations
    
    def _decide_concurrency(self, strategy: Dict[str, Any]) -> int:
        """Decide maximum concurrency based on strategy and resources."""
        # Check if parallel execution is enabled
        if not strategy.get('parallel_execution', True):
            return 1
        
        # Get max concurrency from strategy or use default
        max_concurrency = strategy.get('max_concurrency', 5)
        
        # Check available resources in Redis
        try:
            available_resources = self.redis_client.zcount(
                "resource_pool:fargate",
                '-inf',
                '+inf'
            )
            
            # Don't exceed available resources
            if available_resources > 0:
                max_concurrency = min(max_concurrency, available_resources)
        except Exception as e:
            logger.warning(f"Could not check Redis resources: {e}")
        
        logger.info(f"Decided concurrency: {max_concurrency}")
        return max_concurrency
    
    def _process_tool_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Process and format tool execution results."""
        processed = []
        
        for result in results:
            # Extract key information
            processed_result = {
                'server': result.get('server'),
                'tool': result.get('tool'),
                'success': result.get('success', False),
                'mission_id': self.mission_id
            }
            
            if result.get('success'):
                # Extract findings from content
                content = result.get('content', [])
                if content and isinstance(content, list) and len(content) > 0:
                    try:
                        data = content[0] if isinstance(content[0], dict) else json.loads(content[0].get('text', '{}'))
                        processed_result['findings_count'] = data.get('findings_count', data.get('secrets_found', data.get('vulnerabilities_found', 0)))
                        processed_result['storage'] = data.get('storage', {})
                        processed_result['summary'] = data.get('summary', {})
                    except Exception as e:
                        logger.warning(f"Could not parse result content: {e}")
            else:
                processed_result['error'] = result.get('error', 'Unknown error')
            
            processed.append(processed_result)
        
        return processed
    
    async def _store_results(self, results: List[Dict[str, Any]]):
        """Store processed results to S3."""
        key = f"agent-outputs/coordinator/{self.mission_id}/execution-results.json"
        
        results_json = json.dumps(results, indent=2)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=key,
                Body=results_json,
                ContentType='application/json'
            )
        )
        
        logger.info(f"Execution results stored: s3://{self.s3_artifacts_bucket}/{key}")
    
    def _reflect_on_execution(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Reflect on execution quality and outcomes."""
        total = len(results)
        successful = sum(1 for r in results if r.get('success'))
        failed = total - successful
        
        # Calculate total findings
        total_findings = sum(r.get('findings_count', 0) for r in results if r.get('success'))
        
        reflection = {
            'total': total,
            'successful': successful,
            'failed': failed,
            'success_rate': successful / total if total > 0 else 0,
            'total_findings': total_findings,
            'tools_by_status': {
                'succeeded': [r['tool'] for r in results if r.get('success')],
                'failed': [r['tool'] for r in results if not r.get('success')]
            }
        }
        
        # Log reflection
        self.redis_client.rpush(
            f"agent:{self.mission_id}:coordinator:reflections",
            json.dumps(reflection)
        )
        
        logger.info(f"Reflection: {reflection}")
        return reflection
    
    def _update_state(
        self,
        status: str,
        confidence: float = 0.0,
        error: str = None
    ):
        """Update agent state in Redis."""
        state = {
            'status': status,
            'last_heartbeat': str(int(os.times().elapsed)),
            'confidence_score': str(confidence)
        }
        
        if error:
            state['error_message'] = error
        
        self.redis_client.hset(
            f"agent:{self.mission_id}:coordinator",
            mapping=state
        )
        
        # Add to active agents set
        if status not in ['COMPLETED', 'FAILED']:
            self.redis_client.sadd(
                f"mission:{self.mission_id}:active_agents",
                "coordinator"
            )
        else:
            self.redis_client.srem(
                f"mission:{self.mission_id}:active_agents",
                "coordinator"
            )


def main():
    """Async entry point for Coordinator Agent."""
    agent = CoordinatorAgent()
    result = asyncio.run(agent.run())
    
    print(f"SUCCESS: Executed {result['tools_executed']} tools, {result['tools_succeeded']} succeeded")
    print(f"Success Rate: {result['success_rate']:.1%}")
    
    return 0 if result['success_rate'] > 0.5 else 1


if __name__ == "__main__":
    exit(main())