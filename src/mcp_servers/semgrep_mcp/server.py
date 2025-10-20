"""
Semgrep MCP Server - Static Analysis Security Scanning
Performs SAST analysis using Semgrep rules.
"""

import os
import json
import subprocess
import hashlib
import boto3
import logging
from pathlib import Path
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SemgrepMCPServer:
    """MCP server for Semgrep static analysis."""
    
    def __init__(self):
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        self.tool_name = 'semgrep-mcp'
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        
        logger.info(f"SemgrepMCPServer initialized for mission: {self.mission_id}")
    
    def run(self):
        """Execute Semgrep scan."""
        try:
            # Download source code
            source_path = self._download_source()
            
            # Run Semgrep
            results = self._run_semgrep(source_path)
            
            # Write results
            self._write_results(results)
            
            logger.info(f"Semgrep completed: {len(results.get('results', []))} findings")
            return 0
            
        except Exception as e:
            logger.error(f"Semgrep failed: {str(e)}", exc_info=True)
            self._write_error(str(e))
            return 1
    
    def _download_source(self) -> Path:
        """Download source code from S3."""
        local_path = Path(f"/tmp/{self.mission_id}")
        local_path.mkdir(parents=True, exist_ok=True)
        
        paginator = self.s3_client.get_paginator('list_objects_v2')
        prefix = f"unzipped/{self.mission_id}/"
        
        for page in paginator.paginate(Bucket=self.s3_artifacts_bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                relative_path = key[len(prefix):]
                
                if not relative_path:
                    continue
                
                file_path = local_path / relative_path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                
                self.s3_client.download_file(
                    self.s3_artifacts_bucket,
                    key,
                    str(file_path)
                )
        
        logger.info(f"Downloaded source to {local_path}")
        return local_path
    
    def _run_semgrep(self, source_path: Path) -> dict:
        """Run Semgrep with security rules."""
        try:
            # Run Semgrep with auto config (p/security-audit ruleset)
            result = subprocess.run(
                ['semgrep', '--config=auto', '--json', str(source_path)],
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout
            )
            
            if result.returncode == 0 or result.returncode == 1:  # 1 = findings found
                output = json.loads(result.stdout)
                
                # Format results
                formatted = {
                    'tool': 'semgrep',
                    'version': self._get_semgrep_version(),
                    'scan_duration_ms': 0,  # Will be set later
                    'results': []
                }
                
                for finding in output.get('results', []):
                    formatted['results'].append({
                        'rule_id': finding.get('check_id'),
                        'severity': finding.get('extra', {}).get('severity', 'UNKNOWN'),
                        'message': finding.get('extra', {}).get('message', ''),
                        'file': finding.get('path', ''),
                        'line_start': finding.get('start', {}).get('line', 0),
                        'line_end': finding.get('end', {}).get('line', 0),
                        'code_snippet': finding.get('extra', {}).get('lines', '')
                    })
                
                return formatted
            else:
                raise Exception(f"Semgrep failed with code {result.returncode}: {result.stderr}")
                
        except subprocess.TimeoutExpired:
            logger.error("Semgrep timeout after 5 minutes")
            return {'tool': 'semgrep', 'error': 'timeout', 'results': []}
        except Exception as e:
            logger.error(f"Semgrep execution failed: {e}")
            raise
    
    def _get_semgrep_version(self) -> str:
        """Get Semgrep version."""
        try:
            result = subprocess.run(['semgrep', '--version'], capture_output=True, text=True)
            return result.stdout.strip()
        except:
            return 'unknown'
    
    def _write_results(self, results: dict):
        """Write results to S3 and index in DynamoDB."""
        timestamp = int(time.time())
        
        # Compute digest
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        
        # Write to S3
        s3_key = f"tool-results/{self.tool_name}/{self.mission_id}/{timestamp}/results.json"
        
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=s3_key,
            Body=results_json,
            ContentType='application/json',
            Metadata={
                'tool': self.tool_name,
                'mission-id': self.mission_id,
                'digest': f"sha256:{digest}"
            }
        )
        
        # Write digest file
        digest_key = f"tool-results/{self.tool_name}/{self.mission_id}/{timestamp}/digest.sha256"
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=digest_key,
            Body=f"sha256:{digest}",
            ContentType='text/plain'
        )
        
        # Index in DynamoDB
        self.dynamodb_client.put_item(
            TableName=self.dynamodb_tool_results_table,
            Item={
                'mission_id': {'S': self.mission_id},
                'tool_timestamp': {'S': f"{self.tool_name}#{timestamp}"},
                'tool_name': {'S': self.tool_name},
                's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                'digest': {'S': f"sha256:{digest}"},
                'findings_count': {'N': str(len(results.get('results', [])))},
                'success': {'BOOL': True},
                'execution_duration_ms': {'N': str(results.get('scan_duration_ms', 0))},
                'ttl': {'N': str(timestamp + (7 * 24 * 60 * 60))}  # 7 days
            }
        )
        
        logger.info(f"Results written: s3://{self.s3_artifacts_bucket}/{s3_key}")
        logger.info(f"Digest: sha256:{digest}")
    
    def _write_error(self, error: str):
        """Write error to DynamoDB."""
        timestamp = int(time.time())
        
        self.dynamodb_client.put_item(
            TableName=self.dynamodb_tool_results_table,
            Item={
                'mission_id': {'S': self.mission_id},
                'tool_timestamp': {'S': f"{self.tool_name}#{timestamp}"},
                'tool_name': {'S': self.tool_name},
                's3_uri': {'S': 'error'},
                'digest': {'S': 'error'},
                'findings_count': {'N': '0'},
                'success': {'BOOL': False},
                'error_message': {'S': error},
                'ttl': {'N': str(timestamp + (7 * 24 * 60 * 60))}
            }
        )

def main():
    server = SemgrepMCPServer()
    return server.run()

if __name__ == "__main__":
    exit(main())