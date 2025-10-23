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
import time
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
        self.scan_type = os.environ.get('SCAN_TYPE', 'code')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        self.kendra_index_id = os.environ.get('KENDRA_INDEX_ID', 'test-kendra-index')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        
        # Connect to Redis with retry logic
        self.redis_client = self._connect_redis_with_retry()
        
        self.cognitive_kernel = CognitiveKernel(kendra_index_id=self.kendra_index_id)
        self.agent_state_key = f"agent:{self.mission_id}:strategist"
        
        logger.info(f"StrategistAgent initialized for mission: {self.mission_id}, scan_type: {self.scan_type}")
    
    def _connect_redis_with_retry(self, max_retries=3):
        """Connect to Redis with exponential backoff retry."""
        for attempt in range(max_retries):
            try:
                client = redis.Redis(
                    host=self.redis_endpoint,
                    port=self.redis_port,
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5,
                    retry_on_timeout=True
                )
                client.ping()
                logger.info(f"Redis connection established")
                return client
            except Exception as e:
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt
                    logger.warning(f"Redis connection failed (attempt {attempt+1}/{max_retries}): {e}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"Redis connection failed after {max_retries} attempts")
                    raise RuntimeError(f"Failed to connect to Redis at {self.redis_endpoint}:{self.redis_port}") from e
    
    def run(self) -> ExecutionStrategy:
        """Main execution loop."""
        try:
            self._update_state("SENSING")
            
            # AWS scans don't have Archaeologist context, code scans do
            if self.scan_type == 'aws':
                logger.info("AWS scan - creating minimal context (no Archaeologist)")
                context = self._create_aws_context()
            else:
                logger.info("Code scan - reading context from Archaeologist")
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
        """Read ContextManifest from Archaeologist (code scans only)."""
        key = f"agent-outputs/archaeologist/{self.mission_id}/context-manifest.json"
        
        try:
            response = self.s3_client.get_object(
                Bucket=self.s3_artifacts_bucket,
                Key=key
            )
            return json.loads(response['Body'].read())
        except Exception as e:
            logger.error(f"Failed to read Archaeologist context: {e}")
            logger.warning("Falling back to minimal context")
            return self._create_aws_context()
    
    def _create_aws_context(self) -> Dict:
        """Create minimal context for AWS scans (no Archaeologist available)."""
        return {
            'scan_type': 'aws',
            'mission_id': self.mission_id,
            'service_name': os.environ.get('REPO_NAME', 'aws-infrastructure'),
            'criticality_tier': 1,  # Default to high criticality for AWS
            'handles_pii': True,  # Assume true for AWS to be conservative
            'handles_payment': False,
            'primary_languages': ['aws'],
            'file_count': 0,
            'aws_account_id': os.environ.get('AWS_ACCOUNT_ID', 'unknown'),
            'aws_region': os.environ.get('AWS_REGION', 'us-east-1'),
            'environment': os.environ.get('ENVIRONMENT', 'production')
        }
    
    def _plan_execution(self, context: Dict) -> Dict:
        """Plan tool execution using AI with intelligent analysis."""
        scan_type = context.get('scan_type', 'code')
        
        # For AWS scans, check if we have ScoutSuite findings to analyze
        if scan_type == 'aws':
            scoutsuite_findings = self._get_scoutsuite_findings_if_exist()
            if scoutsuite_findings:
                # Intelligent path: analyze findings with Claude
                return self._plan_aws_execution_with_analysis(context, scoutsuite_findings)
            else:
                # First run: just ScoutSuite discovery
                return self._plan_initial_aws_scan(context)
        
        # Query Kendra for similar missions (code scans)
        query = f"security analysis {context.get('service_name', '')} {' '.join(context.get('primary_languages', []))}"
        kendra_context = self.cognitive_kernel.retrieve_from_kendra(query, top_k=5)
        
        system_prompt = """You are the StrategistAgent. Your role is to analyze the codebase context and select the appropriate security analysis tools.

Available MCP Tools:

Code Security:
- semgrep-mcp: Static analysis for code patterns (supports Python, JS, Java, Go)
- gitleaks-mcp: Secret and credential scanning
- trivy-mcp: Dependency vulnerability scanning

AWS Security:
- scoutsuite-mcp: AWS security posture scanning (IAM, S3, EC2, Lambda, RDS, etc.)
- pacu-mcp: AWS exploit validation and privilege escalation testing

Consider:
- Scan type: 'code' for application code, 'aws' for AWS infrastructure
- Service criticality tier (0=critical requires all tools)
- Languages present (for code scans)
- AWS services in use (for AWS scans)
- Handles PII/payment (requires thorough scanning)
- Past findings for similar services"""

        # Detect scan type from context
        scan_type = context.get('scan_type', 'code')
        
        # Build context string based on scan type
        if scan_type == 'aws':
            context_str = f"""Context:
Scan Type: AWS Infrastructure
Account ID: {context.get('aws_account_id', 'N/A')}
Region: {context.get('aws_region', 'N/A')}
Services to Scan: {', '.join(context.get('aws_services', ['all']))}
Criticality: Tier {context.get('criticality_tier', 1)}
Environment: {context.get('environment', 'production')}"""
        else:
            context_str = f"""Context:
Scan Type: Application Code
Service: {context['service_name']}
Criticality: Tier {context['criticality_tier']}
Handles PII: {context['handles_pii']}
Handles Payment: {context['handles_payment']}
Languages: {', '.join(context['primary_languages'])}
File Count: {context['file_count']}"""

        user_prompt = f"""{context_str}

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
}}

For AWS scans, use scoutsuite-mcp (priority 1) and pacu-mcp (priority 2)."""

        response = self.cognitive_kernel.invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.3
        )
        
        try:
            return json.loads(response.content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude strategy response: {e}")
            logger.error(f"Response content: {response.content[:500]}")
            # Return default strategy on parse failure
            return {
                'tools': [{'name': 'semgrep-mcp', 'priority': 1}],
                'parallel_execution': False,
                'estimated_duration_minutes': 5,
                'reasoning': 'Fallback strategy due to JSON parse error',
                'confidence': 0.3
            }
    
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
            'last_heartbeat': str(int(time.time())),
            'confidence_score': str(confidence)
        }
        if error:
            state['error_message'] = error
        self.redis_client.hset(self.agent_state_key, mapping=state)
    
    def _get_scoutsuite_findings_if_exist(self) -> List[Dict]:
        """Check if ScoutSuite findings exist from a previous scan."""
        try:
            # Check S3 for ScoutSuite results
            key = f"mcp-outputs/scoutsuite/{self.mission_id}/findings.json"
            response = self.s3_client.get_object(
                Bucket=self.s3_artifacts_bucket,
                Key=key
            )
            findings = json.loads(response['Body'].read())
            logger.info(f"Found {len(findings.get('findings', []))} ScoutSuite findings for analysis")
            return findings.get('findings', [])
        except Exception as e:
            logger.debug(f"No existing ScoutSuite findings: {str(e)}")
            return []
    
    def _plan_initial_aws_scan(self, context: Dict) -> Dict:
        """Plan initial AWS scan (just ScoutSuite)."""
        return {
            'tools': [{
                'name': 'scoutsuite-mcp',
                'task_definition': 'hivemind-scoutsuite-mcp',
                'priority': 1,
                'dependencies': []
            }],
            'parallel_execution': False,
            'estimated_duration_minutes': 5,
            'reasoning': 'Initial AWS discovery scan with ScoutSuite. After completion, Strategist will re-run to analyze findings and plan Pacu validation.',
            'confidence': 0.9
        }
    
    def _plan_aws_execution_with_analysis(self, context: Dict, findings: List[Dict]) -> Dict:
        """Plan AWS execution with Claude-based finding analysis."""
        logger.info("Analyzing ScoutSuite findings with Claude for intelligent Pacu selection")
        
        # Analyze findings with Claude
        analysis = self._analyze_findings_with_claude(findings)
        
        tools = []
        
        # Check if we need Pacu validation
        high_priority_findings = [
            f for f in analysis.get('priority_findings', [])
            if f.get('priority_score', 0) >= 7
        ]
        
        if high_priority_findings:
            # Include Pacu with intelligent module selection
            tools.append({
                'name': 'pacu-mcp',
                'task_definition': 'hivemind-pacu-mcp',
                'priority': 1,
                'dependencies': ['scoutsuite-mcp'],  # Pacu depends on ScoutSuite findings
                'context': {
                    'priority_findings': high_priority_findings[:10],  # Top 10
                    'attack_paths': analysis.get('attack_paths', [])
                }
            })
            
            reasoning = f"Identified {len(high_priority_findings)} high-priority findings requiring Pacu validation. "
            if analysis.get('attack_paths'):
                reasoning += f"Detected {len(analysis['attack_paths'])} potential attack paths. "
            
            return {
                'tools': tools,
                'parallel_execution': False,
                'estimated_duration_minutes': 10 + len(high_priority_findings),
                'reasoning': reasoning,
                'confidence': 0.85,
                'analysis': analysis
            }
        else:
            logger.info("No high-priority exploitable findings detected, skipping Pacu")
            return {
                'tools': [],
                'parallel_execution': False,
                'estimated_duration_minutes': 0,
                'reasoning': 'ScoutSuite findings analyzed - no critical exploitable issues requiring Pacu validation',
                'confidence': 0.8,
                'analysis': analysis
            }
    
    def _analyze_findings_with_claude(self, findings: List[Dict]) -> Dict:
        """Analyze AWS findings using Claude to prioritize and select Pacu modules.
        
        Adapted from AutoPurple's ClaudePlanner.analyze_findings().
        """
        if not findings:
            return {'priority_findings': [], 'attack_paths': []}
        
        try:
            # Prepare findings summary (limit to prevent token overflow)
            findings_summary = []
            for f in findings[:20]:
                findings_summary.append({
                    'id': f.get('finding_id', 'unknown'),
                    'service': f.get('service', 'unknown'),
                    'title': f.get('title', ''),
                    'severity': f.get('severity', 'MEDIUM'),
                    'description': f.get('description', '')[:200]
                })
            
            system_prompt = """You are an AWS security expert analyzing security findings from ScoutSuite.

Your expertise includes:
- Identifying genuinely exploitable misconfigurations vs false positives
- Recognizing privilege escalation paths
- Understanding attack chain opportunities
- Prioritizing by business impact"""

            user_prompt = f"""Analyze these AWS security findings and prioritize them by exploitability.

Available Pacu modules for validation:
- iam__privesc_scan: Test for IAM privilege escalation paths
- iam__enum_permissions: Enumerate IAM user/role permissions
- iam__detect_honeytokens: Detect honeytokens
- s3__bucket_finder: Find accessible S3 buckets
- s3__download_bucket: Test S3 bucket data access
- ec2__enum_lateral_movement: Enumerate EC2 lateral movement opportunities
- lambda__enum: Enumerate Lambda functions and permissions
- rds__enum: Enumerate RDS instances and access
- rds__explore_snapshots: Check RDS snapshot access

Findings to analyze:
{json.dumps(findings_summary, indent=2)}

Provide your analysis as JSON:
{{
  "priority_findings": [
    {{
      "finding_id": "string",
      "priority_score": 1-10,
      "exploitability": "low|medium|high|critical",
      "recommended_modules": ["module1", "module2"],
      "rationale": "why this is exploitable and which modules would confirm it"
    }}
  ],
  "attack_paths": [
    {{
      "description": "attack path description (e.g., S3 read -> IAM escalation -> admin)",
      "findings_involved": ["finding_id1", "finding_id2"],
      "modules_needed": ["module1"]
    }}
  ]
}}

Focus on:
1. Real exploitability (can an attacker actually use this?)
2. Privilege escalation opportunities
3. Data access paths
4. Attack chains across multiple findings"""

            response = self.cognitive_kernel.invoke_claude(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.3
            )
            
            # Parse Claude's response
            try:
                analysis = json.loads(response.content)
                logger.info(f"Claude analysis: {len(analysis.get('priority_findings', []))} findings prioritized, "
                          f"{len(analysis.get('attack_paths', []))} attack paths identified")
                return analysis
            except json.JSONDecodeError:
                logger.warning("Claude response not valid JSON, using fallback")
                return self._fallback_analysis(findings)
                
        except Exception as e:
            logger.error(f"Claude analysis failed: {str(e)}")
            return self._fallback_analysis(findings)
    
    def _fallback_analysis(self, findings: List[Dict]) -> Dict:
        """Fallback analysis when Claude is unavailable."""
        priority_findings = []
        
        # Simple severity-based prioritization
        severity_scores = {'CRITICAL': 10, 'HIGH': 8, 'MEDIUM': 5, 'LOW': 3}
        
        for f in findings:
            severity = f.get('severity', 'MEDIUM')
            service = f.get('service', '').lower()
            
            # Map to Pacu modules using simple rules
            modules = self._map_service_to_modules(service, f.get('title', ''))
            
            priority_findings.append({
                'finding_id': f.get('finding_id', 'unknown'),
                'priority_score': severity_scores.get(severity, 5),
                'exploitability': severity.lower(),
                'recommended_modules': modules,
                'rationale': f'Rule-based mapping for {service} {severity} finding'
            })
        
        # Sort by priority
        priority_findings.sort(key=lambda x: x['priority_score'], reverse=True)
        
        return {
            'priority_findings': priority_findings,
            'attack_paths': []
        }
    
    def _map_service_to_modules(self, service: str, title: str) -> List[str]:
        """Map AWS service to Pacu modules (fallback logic)."""
        title_lower = title.lower()
        
        if service == 'iam':
            if 'privilege' in title_lower or 'escalat' in title_lower:
                return ['iam__privesc_scan', 'iam__enum_permissions']
            return ['iam__enum_permissions']
        elif service == 's3':
            if 'public' in title_lower:
                return ['s3__bucket_finder', 's3__download_bucket']
            return ['s3__bucket_finder']
        elif service == 'ec2':
            return ['ec2__enum_lateral_movement']
        elif service == 'lambda':
            return ['lambda__enum']
        elif service == 'rds':
            return ['rds__enum', 'rds__explore_snapshots']
        else:
            return []
    
    def _format_kendra(self, context) -> str:
        """Format Kendra results."""
        if not context or not context.documents:
            return "No historical context"
        return "\n".join([f"- {d['title']}: {d['excerpt'][:150]}..." for d in context.documents[:3]])
    
    def _select_tools_for_patterns(self, patterns: List[str], scan_type: str = 'code') -> List[Dict]:
        """Select appropriate tools based on detected patterns and scan type."""
        tools = []
        
        # AWS infrastructure scan
        if scan_type == 'aws':
            tools.append({
                'name': 'scoutsuite-mcp',
                'task_definition': 'hivemind-scoutsuite-mcp',
                'priority': 1
            })
            tools.append({
                'name': 'pacu-mcp',
                'task_definition': 'hivemind-pacu-mcp',
                'priority': 2
            })
            return tools
        
        # Code security scan - map patterns to tools
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
    output = {
        'mission_id': strategy.mission_id,
        'tools_count': len(strategy.tools),
        'confidence': strategy.confidence_score
    }
    print(json.dumps(output))
    return 0

if __name__ == "__main__":
    exit(main())