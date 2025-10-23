"""
Archivist Agent - Final Storage, Wiki Generation, and Memory Formation

Responsible for:
- Writing consensus findings to DynamoDB
- Generating comprehensive security wiki documentation
- Triggering memory ingestion into Kendra
- Producing beautiful, interactive documentation like DeepWiki
"""

import os
import json
import boto3
import redis
import logging
import time
import sys

from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel
from src.shared.documentation.wiki_generator import SecurityWikiGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ArchivistAgent:
    def __init__(self, scan_id: str = None):
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.scan_type = os.environ.get('SCAN_TYPE', 'code')
        self.dynamodb_findings_table = os.environ.get('DYNAMODB_FINDINGS_TABLE', 'HivemindFindingsArchive')
        self.dynamodb_mission_table = os.environ.get('DYNAMODB_MISSION_TABLE', 'HivemindMissions')
        self.s3_kendra_bucket = os.environ.get('S3_KENDRA_BUCKET', 'hivemind-kendra')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'hivemind-artifacts')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.dynamodb = boto3.client('dynamodb', region_name=region)
        self.s3_client = boto3.client('s3', region_name=region)
        self.lambda_client = boto3.client('lambda', region_name=region)
        
        # Connect to Redis with retry logic
        self.redis_client = self._connect_redis_with_retry()
        
        # Initialize wiki generator
        self.wiki_generator = SecurityWikiGenerator(
            mission_id=self.mission_id,
            s3_bucket=self.s3_artifacts_bucket
        )
        
        logger.info(f"ArchivistAgent initialized for mission: {self.mission_id}, scan_type: {self.scan_type}")
    
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
    
    def run(self):
        try:
            self._update_state("SENSING")
            consensus_findings = self._read_consensus()
            context_manifest = self._load_context_manifest()
            
            self._update_state("ACTING - Archiving Findings")
            archived_count = self._archive_findings(consensus_findings)
            
            self._update_state("ACTING - Generating Wiki")
            wiki_s3_key = self._generate_security_wiki(consensus_findings, context_manifest)
            
            self._update_state("ACTING - Creating Memory")
            self._trigger_memory_ingestor()
            
            self._update_mission_status(archived_count, wiki_s3_key)
            self._cleanup_redis()
            
            self._update_state("COMPLETED", 1.0)
            logger.info(f"ArchivistAgent completed: {archived_count} findings archived, wiki at {wiki_s3_key}")
            
            return {
                'count': archived_count,
                'wiki_url': f"s3://{self.s3_artifacts_bucket}/{wiki_s3_key}"
            }
        except Exception as e:
            logger.error(f"ArchivistAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
    
    def _read_consensus(self):
        """Read consensus findings from Redis negotiation."""
        proposals = self.redis_client.lrange(f"negotiation:{self.mission_id}:proposals", 0, -1)
        
        # Simple consensus: group by finding_id, take latest CONFIRM
        findings_map = {}
        for p_str in proposals:
            try:
                p = json.loads(p_str)
            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse proposal from Redis: {e}. Skipping.")
                continue
            
            if p['agent'] == 'synthesizer':
                finding = p['payload']
                findings_map[finding['finding_id']] = finding
            elif p['agent'] == 'critic' and p['action'] == 'CONFIRM':
                finding_id = p['payload']['finding_id']
                if finding_id in findings_map:
                    findings_map[finding_id]['severity'] = p['payload'].get('revised_severity', findings_map[finding_id]['severity'])
                    findings_map[finding_id]['confidence_score'] = p['payload']['confidence']
        
        return list(findings_map.values())
    
    def _archive_findings(self, findings):
        """Write findings to DynamoDB."""
        for finding in findings:
            timestamp = int(time.time())
            
            try:
                self.dynamodb.put_item(
                    TableName=self.dynamodb_findings_table,
                    Item={
                        'finding_id': {'S': finding['finding_id']},
                        'timestamp': {'N': str(timestamp)},
                        'mission_id': {'S': self.mission_id},
                        'repo_name': {'S': os.environ.get('REPO_NAME', 'unknown')},
                        'title': {'S': finding['title']},
                        'description': {'S': finding['description']},
                        'severity': {'S': finding['severity']},
                        'confidence_score': {'N': str(finding['confidence_score'])},
                        'file_path': {'S': finding['file_path']},
                        'line_numbers': {'L': [{'N': str(ln)} for ln in finding['line_numbers']]},
                        'evidence_digest': {'S': finding.get('evidence_digest', 'unknown')},
                        'tool_source': {'S': finding['tool_source']},
                        'created_at': {'S': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())},
                        'ttl': {'N': str(timestamp + (5 * 365 * 24 * 60 * 60))}  # 5 years
                    }
                )
            except Exception as e:
                logger.error(f"Failed to archive finding {finding['finding_id']} to DynamoDB: {e}")
                # Continue with other findings
        
        logger.info(f"Archived {len(findings)} findings to DynamoDB")
        return len(findings)
    
    def _trigger_memory_ingestor(self):
        """Trigger Lambda to create Kendra documents."""
        try:
            self.lambda_client.invoke(
                FunctionName='HivemindMemoryIngestor',
                InvocationType='Event',
                Payload=json.dumps({'mission_id': self.mission_id})
            )
            logger.info("Memory ingestor triggered")
        except Exception as e:
            logger.warning(f"Failed to trigger memory ingestor: {e}")
    
    def _load_context_manifest(self):
        """Load context manifest from Archaeologist output (code scans only)."""
        # AWS scans don't have Archaeologist output, skip S3 lookup
        if self.scan_type == 'aws':
            logger.info("AWS scan - creating minimal manifest (no Archaeologist)")
            return self._create_aws_minimal_manifest()
        
        # Code scans - try to load from Archaeologist
        try:
            manifest_key = f"agent-outputs/archaeologist/{self.mission_id}/context-manifest.json"
            response = self.s3_client.get_object(
                Bucket=self.s3_artifacts_bucket,
                Key=manifest_key
            )
            manifest = json.loads(response['Body'].read())
            logger.info("Context manifest loaded from Archaeologist")
            return manifest
        except Exception as e:
            logger.warning(f"Could not load context manifest from Archaeologist: {e}")
            logger.info("Falling back to minimal manifest")
            return self._create_code_minimal_manifest()
    
    def _create_aws_minimal_manifest(self):
        """Create minimal manifest for AWS scans."""
        return {
            'mission_id': self.mission_id,
            'scan_type': 'aws',
            'service_name': os.environ.get('REPO_NAME', 'AWS Infrastructure'),
            'criticality_tier': 1,  # AWS is typically high criticality
            'handles_pii': True,  # Assume true for conservative approach
            'handles_payment': False,
            'authentication_present': True,
            'primary_languages': ['aws'],
            'file_count': 0,
            'total_lines': 0,
            'key_files': [],
            'dependencies': [],
            'data_flows': [],
            'confidence_score': 0.8,
            'research_artifacts_s3_key': '',
            'security_patterns_count': 0
        }
    
    def _create_code_minimal_manifest(self):
        """Create minimal manifest for code scans when Archaeologist data unavailable."""
        return {
            'mission_id': self.mission_id,
            'scan_type': 'code',
            'service_name': os.environ.get('REPO_NAME', 'Unknown'),
            'criticality_tier': 2,
            'handles_pii': False,
            'handles_payment': False,
            'authentication_present': False,
            'primary_languages': [],
            'file_count': 0,
            'total_lines': 0,
            'key_files': [],
            'dependencies': [],
            'data_flows': [],
            'confidence_score': 0.5,
            'research_artifacts_s3_key': '',
            'security_patterns_count': 0
        }
    
    def _generate_security_wiki(self, consensus_findings, context_manifest):
        """Generate comprehensive security wiki documentation."""
        logger.info("Generating security wiki...")
        
        try:
            # Prepare findings in format expected by wiki generator
            findings_data = {
                'findings': consensus_findings,
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'mission_id': self.mission_id
            }
            
            # Write findings to S3 for wiki generator
            findings_key = f"agent-outputs/archivist/{self.mission_id}/consensus-findings.json"
            self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=findings_key,
                Body=json.dumps(findings_data, indent=2),
                ContentType='application/json'
            )
            
            # Get research artifacts key from context manifest
            research_key = context_manifest.get('research_artifacts_s3_key', '')
            
            # Generate wiki
            wiki = self.wiki_generator.generate_wiki(
                research_artifacts_key=research_key,
                findings_key=findings_key,
                context_manifest=context_manifest
            )
            
            # Export wiki to S3 as markdown
            wiki_base_key = self.wiki_generator.export_wiki(wiki, output_format="markdown")
            
            # Also export as JSON for programmatic access
            wiki_json_key = self.wiki_generator.export_wiki(wiki, output_format="json")
            
            logger.info(f"Security wiki generated at s3://{self.s3_artifacts_bucket}/{wiki_base_key}")
            
            return wiki_base_key
            
        except Exception as e:
            logger.error(f"Failed to generate wiki: {e}", exc_info=True)
            # Return empty key to not block the pipeline
            return ""
    
    def _update_mission_status(self, findings_count, wiki_s3_key):
        """Update mission status to COMPLETED with wiki link."""
        update_expr = 'SET #status = :status, findings_count = :count, last_updated = :updated'
        expr_values = {
            ':status': {'S': 'COMPLETED'},
            ':count': {'N': str(findings_count)},
            ':updated': {'S': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        }
        
        if wiki_s3_key:
            update_expr += ', wiki_s3_key = :wiki'
            expr_values[':wiki'] = {'S': wiki_s3_key}
        
        self.dynamodb.update_item(
            TableName=self.dynamodb_mission_table,
            Key={'mission_id': {'S': self.mission_id}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues=expr_values
        )
        logger.info("Mission status updated to COMPLETED")
    
    def _cleanup_redis(self):
        """Clean up Redis keys for this mission."""
        keys_to_delete = [
            f"agent:{self.mission_id}:*",
            f"negotiation:{self.mission_id}:*",
            f"mission:{self.mission_id}:*"
        ]
        for pattern in keys_to_delete:
            for key in self.redis_client.scan_iter(match=pattern):
                self.redis_client.delete(key)
        logger.info("Redis keys cleaned up")
    
    def _update_state(self, status: str, confidence: float = 0.0, error: str = None):
        state = {'status': status, 'last_heartbeat': str(int(time.time())), 'confidence_score': str(confidence)}
        if error:
            state['error_message'] = error
        
        state_key = f"agent:{self.mission_id}:archivist"
        self.redis_client.hset(state_key, mapping=state)
        # Set 24-hour TTL on agent state to prevent memory leak
        self.redis_client.expire(state_key, 86400)
    
    def _generate_wiki(self):
        """Alias for _generate_security_wiki for backward compatibility."""
        consensus_findings = self._read_consensus()
        context_manifest = self._load_context_manifest()
        return self._generate_security_wiki(consensus_findings, context_manifest)
    
    def _trigger_memory_ingestion(self):
        """Alias for _trigger_memory_ingestor for backward compatibility."""
        return self._trigger_memory_ingestor()

def main():
    agent = ArchivistAgent()
    result = agent.run()
    output = {
        'mission_id': agent.mission_id,
        'count': result['count'],
        'wiki_url': result.get('wiki_url', '')
    }
    print(json.dumps(output))
    return 0

if __name__ == "__main__":
    exit(main())