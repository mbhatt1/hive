"""
Synthesizer Agent - Finding Generation from Tool Results
Drafts preliminary security findings from MCP tool outputs with evidence chain verification.
"""

import os
import json
import boto3
import redis
import logging
import hashlib
import asyncio
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict

from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class DraftFinding:
    finding_id: str
    title: str
    severity: str  # CRITICAL, HIGH, MEDIUM, LOW
    description: str
    file_path: str
    line_numbers: List[int]
    evidence_digest: str
    tool_source: str
    confidence_score: float

class SynthesizerAgent:
    def __init__(self, scan_id: str = None):
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        self.kendra_index_id = os.environ.get('KENDRA_INDEX_ID', 'test-kendra-index')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        self.redis_client = redis.Redis(host=self.redis_endpoint, port=self.redis_port, decode_responses=True)
        self.cognitive_kernel = CognitiveKernel(kendra_index_id=self.kendra_index_id)
        
        logger.info(f"SynthesizerAgent initialized for mission: {self.mission_id}")
    
    def run(self) -> List[DraftFinding]:
        try:
            self._update_state("SENSING")
            tool_results = self._read_tool_results()
            
            self._update_state("THINKING")
            findings = self._synthesize_findings(tool_results)
            
            self._update_state("ACTING")
            self._write_proposals(findings)
            
            self._update_state("COMPLETED", sum(f.confidence_score for f in findings) / max(len(findings), 1))
            
            logger.info(f"SynthesizerAgent completed with {len(findings)} findings")
            return findings
        except Exception as e:
            logger.error(f"SynthesizerAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
    
    def _read_tool_results(self) -> List[Dict]:
        """Read all MCP tool results from DynamoDB with evidence chain verification."""
        response = self.dynamodb_client.query(
            TableName=self.dynamodb_tool_results_table,
            KeyConditionExpression='mission_id = :mid',
            ExpressionAttributeValues={':mid': {'S': self.mission_id}}
        )
        
        results = []
        for item in response.get('Items', []):
            s3_uri = item['s3_uri']['S']
            stored_digest = item.get('digest', {}).get('S', '')
            tool_name = item.get('tool_name', {}).get('S', 'unknown')
            
            bucket, key = s3_uri.replace('s3://', '').split('/', 1)
            
            obj = self.s3_client.get_object(Bucket=bucket, Key=key)
            content = obj['Body'].read()
            
            # Verify evidence chain
            if stored_digest:
                computed_digest = f"sha256:{hashlib.sha256(content).hexdigest()}"
                if computed_digest != stored_digest:
                    logger.error(f"Evidence chain verification FAILED for {tool_name}: {s3_uri}")
                    logger.error(f"Expected: {stored_digest}, Got: {computed_digest}")
                    continue  # Skip this result
                else:
                    logger.info(f"Evidence chain verified for {tool_name}: {stored_digest}")
            
            result_data = json.loads(content)
            result_data['_verified'] = True
            result_data['_digest'] = stored_digest
            result_data['_tool'] = tool_name
            results.append(result_data)
        
        logger.info(f"Read {len(results)} verified MCP tool results")
        return results
    
    def _synthesize_findings(self, tool_results: List[Dict]) -> List[DraftFinding]:
        """Use AI to synthesize findings."""
        # Query Kendra for enrichment
        kendra_context = self.cognitive_kernel.retrieve_from_kendra(
            query="security vulnerabilities patterns best practices",
            top_k=5
        )
        
        system_prompt = """You are the SynthesizerAgent. Analyze security tool outputs and draft findings.

For each issue found:
1. Assign severity: CRITICAL, HIGH, MEDIUM, or LOW
2. Provide clear title and description
3. Cite evidence (tool + digest + line numbers)
4. Assign confidence score (0.0-1.0)"""

        user_prompt = f"""Tool Results:
{json.dumps(tool_results, indent=2)}

Historical Context:
{self._format_kendra(kendra_context)}

Draft findings in JSON array:
[
  {{
    "title": "SQL Injection Vulnerability",
    "severity": "CRITICAL",
    "description": "...",
    "file_path": "auth.py",
    "line_numbers": [42],
    "tool_source": "semgrep-mcp",
    "confidence": 0.9
  }}
]"""

        response = self.cognitive_kernel.invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=4096,
            temperature=0.3
        )
        
        findings_data = json.loads(response.content)
        findings = []
        
        for f in findings_data:
            finding_id = hashlib.sha256(f"{self.mission_id}{f['title']}".encode()).hexdigest()[:16]
            findings.append(DraftFinding(
                finding_id=finding_id,
                title=f['title'],
                severity=f['severity'],
                description=f['description'],
                file_path=f['file_path'],
                line_numbers=f['line_numbers'],
                evidence_digest=f.get('evidence_digest', 'unknown'),
                tool_source=f['tool_source'],
                confidence_score=f['confidence']
            ))
        
        return findings
    
    def _write_proposals(self, findings: List[DraftFinding]):
        """Write draft findings to Redis for negotiation."""
        for finding in findings:
            self.redis_client.rpush(
                f"negotiation:{self.mission_id}:proposals",
                json.dumps({
                    'agent': 'synthesizer',
                    'action': 'PROPOSE',
                    'payload': asdict(finding),
                    'timestamp': int(os.times().elapsed)
                })
            )
        
        key = f"agent-outputs/synthesizer/{self.mission_id}/draft-findings.json"
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=key,
            Body=json.dumps([asdict(f) for f in findings], indent=2)
        )
        
        logger.info(f"Wrote {len(findings)} proposals to Redis")
    
    def _update_state(self, status: str, confidence: float = 0.0, error: str = None):
        state = {'status': status, 'last_heartbeat': str(int(os.times().elapsed)), 'confidence_score': str(confidence)}
        if error:
            state['error_message'] = error
        self.redis_client.hset(f"agent:{self.mission_id}:synthesizer", mapping=state)
    
    def _format_kendra(self, context) -> str:
        if not context or not context.documents:
            return "No context"
        return "\n".join([f"- {d['title']}: {d['excerpt'][:100]}..." for d in context.documents[:3]])
    
    def _deduplicate_findings(self, findings: List[DraftFinding]) -> List[DraftFinding]:
        """Deduplicate findings based on file path and similarity."""
        seen = {}
        unique_findings = []
        
        for finding in findings:
            # Create a key based on file_path and title
            key = f"{finding.file_path}:{finding.title}"
            if key not in seen:
                seen[key] = finding
                unique_findings.append(finding)
            else:
                # Keep the one with higher confidence
                if finding.confidence_score > seen[key].confidence_score:
                    seen[key] = finding
                    # Replace in unique_findings
                    unique_findings = [f if f.finding_id != seen[key].finding_id else finding for f in unique_findings]
        
        return unique_findings
    
    def _calculate_severity(self, finding_data: Dict) -> str:
        """Calculate severity based on finding characteristics."""
        # Simple severity calculation based on patterns
        title_lower = finding_data.get('title', '').lower()
        description_lower = finding_data.get('description', '').lower()
        
        # Critical patterns
        if any(pattern in title_lower or pattern in description_lower
               for pattern in ['sql injection', 'remote code execution', 'authentication bypass']):
            return 'CRITICAL'
        
        # High severity patterns
        if any(pattern in title_lower or pattern in description_lower
               for pattern in ['xss', 'csrf', 'hardcoded credential', 'secret']):
            return 'HIGH'
        
        # Medium severity patterns
        if any(pattern in title_lower or pattern in description_lower
               for pattern in ['deprecated', 'weak', 'insecure']):
            return 'MEDIUM'
        
        # Default to LOW
        return 'LOW'

def main():
    agent = SynthesizerAgent()
    findings = agent.run()
    print(f"SUCCESS: {len(findings)} findings drafted")
    return 0

if __name__ == "__main__":
    exit(main())