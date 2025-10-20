"""
Coordinator Agent - Resource Allocation and Scheduling
Allocates resources for MCP tool execution based on strategy.
"""

import os
import json
import boto3
import redis
import logging
import sys

from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class CoordinatorAgent:
    def __init__(self, scan_id: str = None):
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'hivemind-artifacts')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.redis_client = redis.Redis(host=self.redis_endpoint, port=self.redis_port, decode_responses=True)
        logger.info(f"CoordinatorAgent initialized for mission: {self.mission_id}")
    
    def run(self):
        try:
            self._update_state("SENSING")
            strategy = self._read_execution_strategy()
            
            self._update_state("DECIDING")
            allocation = self._allocate_resources(strategy)
            
            self._update_state("ACTING")
            self._write_allocation(allocation)
            
            self._update_state("COMPLETED", 1.0)
            logger.info(f"CoordinatorAgent completed: {len(allocation['tools'])} tools scheduled")
        except Exception as e:
            logger.error(f"CoordinatorAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
    
    def _read_execution_strategy(self):
        key = f"agent-outputs/strategist/{self.mission_id}/execution-strategy.json"
        obj = self.s3_client.get_object(Bucket=self.s3_artifacts_bucket, Key=key)
        return json.loads(obj['Body'].read())
    
    def _allocate_resources(self, strategy):
        # Mark resources as allocated in Redis
        for tool in strategy['tools']:
            self.redis_client.zadd(
                f"resource_pool:fargate",
                {f"task-{tool['name']}-{self.mission_id}": int(os.times().elapsed) + 300}
            )
        
        return {
            'mission_id': self.mission_id,
            'tools': strategy['tools'],
            'parallel': strategy['parallel_execution'],
            'allocated_at': int(os.times().elapsed)
        }
    
    def _write_allocation(self, allocation):
        key = f"agent-outputs/coordinator/{self.mission_id}/resource-allocation.json"
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=key,
            Body=json.dumps(allocation, indent=2)
        )
        logger.info("Resource allocation written")
    
    def _update_state(self, status: str, confidence: float = 0.0, error: str = None):
        state = {'status': status, 'last_heartbeat': str(int(os.times().elapsed)), 'confidence_score': str(confidence)}
        if error:
            state['error_message'] = error
        self.redis_client.hset(f"agent:{self.mission_id}:coordinator", mapping=state)
    
    def _determine_execution_mode(self, strategy):
        """Determine if tools should run in parallel or sequential mode."""
        return strategy.get('parallel_execution', True)

def main():
    agent = CoordinatorAgent()
    agent.run()
    print("SUCCESS: Resources allocated")
    return 0

if __name__ == "__main__":
    exit(main())