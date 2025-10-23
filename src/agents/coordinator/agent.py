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
import time
import shutil
from pathlib import Path
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
        try:
            self.mission_id = scan_id or os.environ['MISSION_ID']
            self.s3_artifacts_bucket = os.environ['S3_ARTIFACTS_BUCKET']
            self.dynamodb_tool_results_table = os.environ['DYNAMODB_TOOL_RESULTS_TABLE']
            self.redis_endpoint = os.environ['REDIS_ENDPOINT']
            self.redis_port = int(os.environ['REDIS_PORT'])
            self.kendra_index_id = os.environ['KENDRA_INDEX_ID']
        except KeyError as e:
            raise RuntimeError(f"Missing required environment variable: {e}")
        except ValueError as e:
            raise RuntimeError(f"Invalid environment variable value: {e}")
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        
        try:
            self.redis_client = redis.Redis(
                host=self.redis_endpoint,
                port=self.redis_port,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True
            )
            self.redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}. Agent will run without state tracking.")
            self.redis_client = None
        
        # Initialize cognitive kernel with MCP support
        self.cognitive_kernel = CognitiveKernel(
            region=region,
            kendra_index_id=self.kendra_index_id
        )
        
        logger.info(f"CoordinatorAgent initialized for mission: {self.mission_id} with MCP support")
    
    def _download_code_from_s3(self) -> str:
        """
        Download code from S3 to local filesystem for MCP tool access.
        
        Returns:
            Local path where code was downloaded
        """
        local_base = f"/tmp/{self.mission_id}"
        s3_prefix = f"unzipped/{self.mission_id}/"
        
        try:
            # Create local directory
            Path(local_base).mkdir(parents=True, exist_ok=True)
            
            # List and download all objects with the prefix
            paginator = self.s3_client.get_paginator('list_objects_v2')
            page_iterator = paginator.paginate(
                Bucket=self.s3_artifacts_bucket,
                Prefix=s3_prefix
            )
            
            downloaded_count = 0
            for page in page_iterator:
                if 'Contents' not in page:
                    continue
                    
                for obj in page['Contents']:
                    s3_key = obj['Key']
                    # Remove prefix to get relative path
                    relative_path = s3_key[len(s3_prefix):]
                    
                    if not relative_path:  # Skip directory markers
                        continue
                    
                    local_file = os.path.join(local_base, relative_path)
                    
                    # Create parent directories
                    Path(local_file).parent.mkdir(parents=True, exist_ok=True)
                    
                    # Download file
                    logger.info(f"Downloading {s3_key} to {local_file}")
                    self.s3_client.download_file(
                        self.s3_artifacts_bucket,
                        s3_key,
                        local_file
                    )
                    downloaded_count += 1
            
            logger.info(f"Downloaded {downloaded_count} files from S3 to {local_base}")
            return local_base
            
        except Exception as e:
            logger.error(f"Failed to download code from S3: {e}", exc_info=True)
            raise RuntimeError(f"Code download failed: {e}")
    
    async def run(self) -> Dict[str, Any]:
        """
        Main async execution loop with MCP tool invocation.
        
        Returns:
            Dictionary with execution results
        """
        local_code_path = None
        try:
            # SENSE: Download code from S3 and read strategy
            self._update_state("SENSING")
            local_code_path = self._download_code_from_s3()
            strategy = await self._read_execution_strategy()
            available_tools = await self.cognitive_kernel.list_mcp_tools()
            
            logger.info(f"Code downloaded to: {local_code_path}")
            logger.info(f"Available MCP tools: {list(available_tools.keys())}")
            
            # THINK: Create MCP tool invocation plan with local path
            self._update_state("THINKING")
            tool_invocations = self._create_mcp_invocation_plan(strategy, available_tools, local_code_path)
            
            # DECIDE: Determine parallel execution strategy
            self._update_state("DECIDING")
            max_concurrency = self._decide_concurrency(strategy)
            
            # ACT: Execute MCP tools in parallel
            self._update_state("ACTING")
            results = await self._act(tool_invocations, max_concurrency)
            
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
            
            # Cleanup downloaded code
            if local_code_path and os.path.exists(local_code_path):
                try:
                    shutil.rmtree(local_code_path)
                    logger.info(f"Cleaned up downloaded code at {local_code_path}")
                except Exception as e:
                    logger.warning(f"Error cleaning up code directory: {e}")
    
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
        available_tools: Dict[str, List[Dict]],
        local_code_path: str
    ) -> List[Dict[str, Any]]:
        """
        Create MCP tool invocation plan from strategy.
        
        Args:
            strategy: Execution strategy from Strategist
            available_tools: Available MCP tools from registry
            local_code_path: Local filesystem path where code is downloaded
            
        Returns:
            List of tool invocation specifications
        """
        invocations = []
        source_path = local_code_path
        
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
        if self.redis_client:
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
    
    async def _act(self, tool_invocations: List[Dict[str, Any]], max_concurrency: int = 5) -> List[Dict[str, Any]]:
        """
        Execute MCP tools based on invocation plan.
        
        Args:
            tool_invocations: List of tool invocation specifications
            max_concurrency: Maximum number of parallel tool executions
            
        Returns:
            List of tool execution results
        """
        logger.info(f"Executing {len(tool_invocations)} MCP tools with concurrency={max_concurrency}")
        
        results = await self.cognitive_kernel.invoke_mcp_tools_parallel(
            tool_invocations,
            max_concurrency=max_concurrency
        )
        
        return results
    
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
                # Extract scan results from MCP response
                content = result.get('content', [])
                if content and isinstance(content, list) and len(content) > 0:
                    try:
                        # Parse MCP JSON response
                        data = content[0] if isinstance(content[0], dict) else json.loads(content[0].get('text', '{}'))
                        
                        # Extract the actual scan results (MCPs now return 'results' field)
                        scan_results = data.get('results', {})
                        processed_result['raw_results'] = scan_results
                        processed_result['findings_count'] = data.get('findings_count', data.get('secrets_found', data.get('vulnerabilities_found', 0)))
                        processed_result['summary'] = data.get('summary', {})
                        
                    except Exception as e:
                        logger.warning(f"Could not parse result content: {e}")
                        processed_result['error'] = f"Parse error: {e}"
            else:
                processed_result['error'] = result.get('error', 'Unknown error')
            
            processed.append(processed_result)
        
        return processed
    
    async def _store_results(self, results: List[Dict[str, Any]]):
        """Store processed results to both S3 and DynamoDB."""
        import hashlib
        
        # Store coordinator summary to S3
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
        logger.info(f"Execution results stored to S3: s3://{self.s3_artifacts_bucket}/{key}")
        
        # Store each tool's raw results to S3 and metadata to DynamoDB
        for result in results:
            if result.get('success') and result.get('raw_results'):
                tool_server = result['server']
                tool_name = result['tool']
                timestamp = int(time.time())
                
                # Store raw results to S3
                results_key = f"tool-results/{tool_server}/{self.mission_id}/{timestamp}/results.json"
                results_data = json.dumps(result['raw_results'], indent=2, sort_keys=True)
                
                try:
                    await loop.run_in_executor(
                        None,
                        lambda: self.s3_client.put_object(
                            Bucket=self.s3_artifacts_bucket,
                            Key=results_key,
                            Body=results_data,
                            ContentType='application/json'
                        )
                    )
                    
                    s3_uri = f"s3://{self.s3_artifacts_bucket}/{results_key}"
                    digest = f"sha256:{hashlib.sha256(results_data.encode()).hexdigest()}"
                    
                    logger.info(f"Stored {tool_name} raw results to S3: {s3_uri}")
                    
                    # Store metadata to DynamoDB for Synthesizer
                    await loop.run_in_executor(
                        None,
                        lambda: self.dynamodb_client.put_item(
                            TableName=self.dynamodb_tool_results_table,
                            Item={
                                'mission_id': {'S': self.mission_id},
                                'tool_timestamp': {'S': f"{tool_server}:{tool_name}:{timestamp}"},
                                'tool_name': {'S': f"{tool_server}:{tool_name}"},
                                's3_uri': {'S': s3_uri},
                                'digest': {'S': digest},
                                'status': {'S': 'completed'},
                                'timestamp': {'N': str(timestamp)},
                                'findings_count': {'N': str(result.get('findings_count', 0))}
                            }
                        )
                    )
                    logger.info(f"Stored {tool_name} metadata to DynamoDB")
                    
                except Exception as e:
                    logger.error(f"Failed to store {tool_name} results: {e}")
            elif not result.get('success'):
                # Store failure to DynamoDB
                try:
                    failure_timestamp = int(time.time())
                    await loop.run_in_executor(
                        None,
                        lambda r=result: self.dynamodb_client.put_item(
                            TableName=self.dynamodb_tool_results_table,
                            Item={
                                'mission_id': {'S': self.mission_id},
                                'tool_timestamp': {'S': f"{r['server']}:{r['tool']}:{failure_timestamp}"},
                                'tool_name': {'S': f"{r['server']}:{r['tool']}"},
                                's3_uri': {'S': ''},
                                'digest': {'S': ''},
                                'status': {'S': 'failed'},
                                'timestamp': {'N': str(failure_timestamp)},
                                'error': {'S': r.get('error', 'Unknown error')},
                                'findings_count': {'N': '0'}
                            }
                        )
                    )
                except Exception as e:
                    logger.error(f"Failed to store failure for {result.get('tool')}: {e}")
    
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
        if self.redis_client:
            reflection_key = f"agent:{self.mission_id}:coordinator:reflections"
            try:
                self.redis_client.rpush(
                    reflection_key,
                    json.dumps(reflection)
                )
                # Set 24-hour TTL on reflection list to prevent memory leak
                self.redis_client.expire(reflection_key, 86400)
            except Exception as e:
                logger.warning(f"Failed to log reflection to Redis: {e}")
        
        logger.info(f"Reflection: {reflection}")
        return reflection
    
    def _update_state(
        self,
        status: str,
        confidence: float = 0.0,
        error: str = None
    ):
        """Update agent state in Redis."""
        if not self.redis_client:
            logger.debug(f"State update skipped (no Redis): {status}")
            return
        
        state = {
            'status': status,
            'last_heartbeat': str(int(time.time())),
            'confidence_score': str(confidence)
        }
        
        if error:
            state['error_message'] = error
        
        state_key = f"agent:{self.mission_id}:coordinator"
        try:
            self.redis_client.hset(
                state_key,
                mapping=state
            )
            # Set 24-hour TTL on agent state to prevent memory leak
            self.redis_client.expire(state_key, 86400)
            
            # Add to active agents set
            active_agents_key = f"mission:{self.mission_id}:active_agents"
            if status not in ['COMPLETED', 'FAILED']:
                self.redis_client.sadd(
                    active_agents_key,
                    "coordinator"
                )
                # Set 24-hour TTL on active agents set to prevent memory leak
                self.redis_client.expire(active_agents_key, 86400)
            else:
                self.redis_client.srem(
                    f"mission:{self.mission_id}:active_agents",
                    "coordinator"
                )
        except Exception as e:
            logger.warning(f"Redis state update failed: {e}")


def main():
    """Async entry point for Coordinator Agent."""
    agent = CoordinatorAgent()
    result = asyncio.run(agent.run())
    
    # Output JSON for Step Functions to capture
    output = {
        'mission_id': result['mission_id'],
        'tools_executed': result['tools_executed'],
        'tools_succeeded': result['tools_succeeded'],
        'success_rate': result['success_rate']
    }
    print(json.dumps(output))
    
    return 0 if result['success_rate'] > 0.5 else 1


if __name__ == "__main__":
    exit(main())