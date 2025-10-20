"""
Strategist Agent - Planning and Tool Selection

Responsibilities:
1. Consume ContextManifest from Archaeologist
2. Query Kendra for similar past missions
3. Generate MCP tool execution plan
4. Output ExecutionStrategy
"""

import os
import json
import boto3
import redis
import logging
from typing import Dict, List
from dataclasses import dataclass, asdict
import sys

from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ExecutionStrategy:
    """Output from Strategist Agent."""
    mission_id: str
    tools: List[Dict[str, str]]  # [{name, task_definition, priority}]
    parallel_execution: bool
    estimated_duration_minutes: int
    reasoning: str
    confidence_score: float

class StrategistAgent:
    """Agent for planning and tool selection."""
    
    def __init__(self, scan_id: str = None):
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        self.kendra_index_id = os.environ.get('KENDRA_INDEX_ID', 'test-kendra-index')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.redis_client = redis.Redis(
            host=self.redis_endpoint,
            port=self.redis_port,
            decode_responses=True
        )
        self.cognitive_kernel = CognitiveKernel(kendra_index_id=self.kendra_index_id)
        self.agent_state_key = f"agent:{self.mission_id}:strategist"
        
        logger.info(f"StrategistAgent initialized for mission: {self.mission_id}")
    
    def run(self) -> ExecutionStrategy:
        """Main execution loop."""
        try:
            self._update_state("SENSING")
            context = self._read_context_manifest()
            
            self._update_state("THINKING")
            strategy = self._plan_execution(context)
            
            self._update_state("DECIDING")
            final_strategy = self._decide_strategy(strategy, context)
            
            self._update_state("ACTING")
            self._write_output(final_strategy)
            
            self._update_state("COMPLETED", final_strategy.confidence_score)
            
            logger.info(f"StrategistAgent completed. Tools selected: {len(final_strategy.tools)}")
            return final_strategy
            
        except Exception as e:
            logger.error(f"StrategistAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
    
    def _read_context_manifest(self) -> Dict:
        """Read ContextManifest from Archaeologist."""
        key = f"agent-outputs/archaeologist/{self.mission_id}/context-manifest.json"
        
        response = self.s3_client.get_object(
            Bucket=self.s3_artifacts_bucket,
            Key=key
        )
        
        return json.loads(response['Body'].read())
    
    def _plan_execution(self, context: Dict) -> Dict:
        """Plan tool execution using AI."""
        # Query Kendra for similar missions
        query = f"security analysis {context['service_name']} {' '.join(context['primary_languages'])}"
        kendra_context = self.cognitive_kernel.retrieve_from_kendra(query, top_k=5)
        
        system_prompt = """You are the StrategistAgent. Your role is to analyze the codebase context and select the appropriate security analysis tools.

Available MCP Tools:
- semgrep-mcp: Static analysis for code patterns (supports Python, JS, Java, Go)
- gitleaks-mcp: Secret and credential scanning
- trivy-mcp: Dependency vulnerability scanning

Consider:
- Service criticality tier (0=critical requires all tools)
- Languages present
- Handles PII/payment (requires thorough scanning)
- Past findings for similar services"""

        user_prompt = f"""Context:
Service: {context['service_name']}
Criticality: Tier {context['criticality_tier']}
Handles PII: {context['handles_pii']}
Handles Payment: {context['handles_payment']}
Languages: {', '.join(context['primary_languages'])}
File Count: {context['file_count']}

Historical Context from Kendra:
{self._format_kendra(kendra_context)}

Generate execution plan in JSON:
{{
  "tools": [
    {{"name": "semgrep-mcp", "task_definition": "hivemind-semgrep-mcp", "priority": 1}},
    {{"name": "gitleaks-mcp", "task_definition": "hivemind-gitleaks-mcp", "priority": 2}}
  ],
  "parallel_execution": true,
  "estimated_duration_minutes": 5,
  "reasoning": "explanation",
  "confidence": 0.0-1.0
}}"""

        response = self.cognitive_kernel.invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.3
        )
        
        return json.loads(response.content)
    
    def _decide_strategy(self, strategy: Dict, context: Dict) -> ExecutionStrategy:
        """Create final ExecutionStrategy."""
        return ExecutionStrategy(
            mission_id=self.mission_id,
            tools=strategy.get('tools', []),
            parallel_execution=strategy.get('parallel_execution', True),
            estimated_duration_minutes=strategy.get('estimated_duration_minutes', 10),
            reasoning=strategy.get('reasoning', ''),
            confidence_score=strategy.get('confidence', 0.8)
        )
    
    def _write_output(self, strategy: ExecutionStrategy):
        """Write ExecutionStrategy to S3."""
        key = f"agent-outputs/strategist/{self.mission_id}/execution-strategy.json"
        
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=key,
            Body=json.dumps(asdict(strategy), indent=2),
            ContentType='application/json'
        )
        
        self.redis_client.hset(
            self.agent_state_key,
            'output_s3_uri',
            f"s3://{self.s3_artifacts_bucket}/{key}"
        )
        
        logger.info(f"ExecutionStrategy written to S3")
    
    def _update_state(self, status: str, confidence: float = 0.0, error: str = None):
        """Update agent state in Redis."""
        state = {
            'status': status,
            'last_heartbeat': str(int(os.times().elapsed)),
            'confidence_score': str(confidence)
        }
        if error:
            state['error_message'] = error
        self.redis_client.hset(self.agent_state_key, mapping=state)
    
    def _format_kendra(self, context) -> str:
        """Format Kendra results."""
        if not context or not context.documents:
            return "No historical context"
        return "\n".join([f"- {d['title']}: {d['excerpt'][:150]}..." for d in context.documents[:3]])
    
    def _select_tools_for_patterns(self, patterns: List[str]) -> List[Dict]:
        """Select appropriate tools based on detected code patterns."""
        tools = []
        
        # Map patterns to tools
        if any(p in ['secrets', 'credentials', 'api_keys'] for p in patterns):
            tools.append({
                'name': 'gitleaks-mcp',
                'task_definition': 'hivemind-gitleaks-mcp',
                'priority': 1
            })
        
        if any(p in ['vulnerabilities', 'sql_injection', 'xss', 'security'] for p in patterns):
            tools.append({
                'name': 'semgrep-mcp',
                'task_definition': 'hivemind-semgrep-mcp',
                'priority': 2
            })
        
        if any(p in ['dependencies', 'packages', 'libraries'] for p in patterns):
            tools.append({
                'name': 'trivy-mcp',
                'task_definition': 'hivemind-trivy-mcp',
                'priority': 3
            })
        
        return tools if tools else [
            {'name': 'semgrep-mcp', 'task_definition': 'hivemind-semgrep-mcp', 'priority': 1}
        ]

def main():
    agent = StrategistAgent()
    strategy = agent.run()
    print(f"SUCCESS: Strategy created with {len(strategy.tools)} tools")
    return 0

if __name__ == "__main__":
    exit(main())