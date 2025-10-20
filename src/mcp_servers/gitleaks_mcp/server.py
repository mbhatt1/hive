"""
Gitleaks MCP Server - Secret and Credential Scanning
Detects hardcoded secrets, API keys, passwords, etc.
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

class GitleaksMCPServer:
    def __init__(self):
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        self.tool_name = 'gitleaks-mcp'
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        logger.info(f"GitleaksMCPServer initialized for mission: {self.mission_id}")
    
    def run(self):
        try:
            source_path = self._download_source()
            results = self._run_gitleaks(source_path)
            self._write_results(results)
            logger.info(f"Gitleaks completed: {len(results.get('results', []))} secrets found")
            return 0
        except Exception as e:
            logger.error(f"Gitleaks failed: {str(e)}", exc_info=True)
            self._write_error(str(e))
            return 1
    
    def _download_source(self) -> Path:
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
                self.s3_client.download_file(self.s3_artifacts_bucket, key, str(file_path))
        return local_path
    
    def _run_gitleaks(self, source_path: Path) -> dict:
        try:
            result = subprocess.run(
                ['gitleaks', 'detect', '--source', str(source_path), '--report-format', 'json', '--report-path', '/tmp/gitleaks-report.json', '--no-git'],
                capture_output=True,
                text=True,
                timeout=180
            )
            
            # Gitleaks returns 1 if secrets found, 0 if clean
            if result.returncode in [0, 1]:
                try:
                    with open('/tmp/gitleaks-report.json', 'r') as f:
                        findings = json.load(f)
                except:
                    findings = []
                
                formatted = {
                    'tool': 'gitleaks',
                    'version': self._get_version(),
                    'results': []
                }
                
                for finding in findings:
                    formatted['results'].append({
                        'rule_id': finding.get('RuleID', 'unknown'),
                        'secret_type': finding.get('Description', 'unknown'),
                        'file': finding.get('File', ''),
                        'line_number': finding.get('StartLine', 0),
                        'match': finding.get('Match', ''),
                        'commit': finding.get('Commit', 'N/A')
                    })
                
                return formatted
            else:
                raise Exception(f"Gitleaks failed: {result.stderr}")
        except subprocess.TimeoutExpired:
            return {'tool': 'gitleaks', 'error': 'timeout', 'results': []}
    
    def _get_version(self) -> str:
        try:
            result = subprocess.run(['gitleaks', 'version'], capture_output=True, text=True)
            return result.stdout.strip()
        except:
            return 'unknown'
    
    def _write_results(self, results: dict):
        timestamp = int(time.time())
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        s3_key = f"tool-results/{self.tool_name}/{self.mission_id}/{timestamp}/results.json"
        
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=s3_key,
            Body=results_json,
            ContentType='application/json',
            Metadata={'tool': self.tool_name, 'digest': f"sha256:{digest}"}
        )
        
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
                'ttl': {'N': str(timestamp + (7 * 24 * 60 * 60))}
            }
        )
    
    def _write_error(self, error: str):
        timestamp = int(time.time())
        self.dynamodb_client.put_item(
            TableName=self.dynamodb_tool_results_table,
            Item={
                'mission_id': {'S': self.mission_id},
                'tool_timestamp': {'S': f"{self.tool_name}#{timestamp}"},
                'tool_name': {'S': self.tool_name},
                'success': {'BOOL': False},
                'error_message': {'S': error},
                'ttl': {'N': str(timestamp + (7 * 24 * 60 * 60))}
            }
        )

def main():
    server = GitleaksMCPServer()
    return server.run()

if __name__ == "__main__":
    exit(main())