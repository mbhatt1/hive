"""
ScoutSuite MCP Server - AWS Infrastructure Security Scanning
Performs comprehensive AWS security audits and compliance checks
"""

import os
import json
import subprocess
import hashlib
import boto3
import logging
from pathlib import Path
import time
import uuid

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ScoutSuiteMCPServer:
    def __init__(self):
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        self.tool_name = 'scoutsuite-mcp'
        
        # AWS configuration for scanning
        self.aws_account = os.environ.get('AWS_ACCOUNT_ID', '')
        self.aws_region = os.environ.get('AWS_TARGET_REGION', 'us-east-1')
        self.aws_profile = os.environ.get('AWS_PROFILE', 'default')
        self.services = os.environ.get('SERVICES', '').split(',') if os.environ.get('SERVICES') else []
        self.scan_timeout = int(os.environ.get('SCAN_TIMEOUT_MINUTES', '30'))  # Default 30 minutes
        self.cross_account_role_arn = os.environ.get('CROSS_ACCOUNT_ROLE_ARN', '')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        self.secrets_client = boto3.client('secretsmanager', region_name=region)
        
        # Load credentials from Secrets Manager if configured
        self._load_scan_credentials()
        
        logger.info(f"ScoutSuiteMCPServer initialized for mission: {self.mission_id}")
        logger.info(f"Target AWS Account: {self.aws_account}, Region: {self.aws_region}")
    
    def _load_scan_credentials(self):
        """Load AWS scan credentials from Secrets Manager if configured."""
        secret_name = os.environ.get('AWS_SCAN_CREDENTIALS_SECRET')
        if not secret_name:
            logger.info("No AWS_SCAN_CREDENTIALS_SECRET configured, using default credentials")
            return
        
        try:
            response = self.secrets_client.get_secret_value(SecretId=secret_name)
            credentials = json.loads(response['SecretString'])
            
            # Set environment variables for ScoutSuite to use
            if 'access_key_id' in credentials:
                os.environ['AWS_ACCESS_KEY_ID'] = credentials['access_key_id']
            if 'secret_access_key' in credentials:
                os.environ['AWS_SECRET_ACCESS_KEY'] = credentials['secret_access_key']
            if 'session_token' in credentials:
                os.environ['AWS_SESSION_TOKEN'] = credentials['session_token']
            if 'role_arn' in credentials:
                os.environ['AWS_ROLE_ARN'] = credentials['role_arn']
            
            logger.info(f"Loaded scan credentials from Secrets Manager: {secret_name}")
        except Exception as e:
            logger.warning(f"Failed to load credentials from Secrets Manager: {e}")
    
    def run(self):
        try:
            results = self._run_scoutsuite()
            self._write_results(results)
            findings_count = self._count_findings(results)
            logger.info(f"ScoutSuite completed: {findings_count} findings discovered")
            return 0
        except Exception as e:
            logger.error(f"ScoutSuite failed: {str(e)}", exc_info=True)
            self._write_error(str(e))
            return 1
    
    def _run_scoutsuite(self) -> dict:
        """Run ScoutSuite AWS security scan."""
        try:
            # Prepare report directory
            report_dir = Path(f"/tmp/scoutsuite-reports/{self.mission_id}")
            report_dir.mkdir(parents=True, exist_ok=True)
            
            report_name = f"scan_{uuid.uuid4().hex[:8]}"
            
            # Build ScoutSuite command
            cmd = [
                'scout', 'aws',
                '--report-dir', str(report_dir),
                '--report-name', report_name,
                '--no-browser'
            ]
            
            # Add AWS credentials
            if os.environ.get('AWS_ACCESS_KEY_ID') and os.environ.get('AWS_SECRET_ACCESS_KEY'):
                cmd.extend([
                    '--access-keys',
                    '--access-key-id', os.environ.get('AWS_ACCESS_KEY_ID'),
                    '--secret-access-key', os.environ.get('AWS_SECRET_ACCESS_KEY')
                ])
                if os.environ.get('AWS_SESSION_TOKEN'):
                    cmd.extend(['--session-token', os.environ.get('AWS_SESSION_TOKEN')])
            else:
                cmd.extend(['--profile', self.aws_profile])
            
            # Add region filter
            if self.aws_region:
                cmd.extend(['--regions', self.aws_region])
            
            # Add service filter
            if self.services and self.services[0]:
                cmd.extend(['--services'] + self.services)
            
            # Add cross-account role if configured
            if self.cross_account_role_arn:
                logger.info(f"Using cross-account role: {self.cross_account_role_arn}")
                cmd.extend(['--assume-role', self.cross_account_role_arn])
            
            logger.info(f"Running ScoutSuite: {' '.join(cmd)}")
            timeout_seconds = self.scan_timeout * 60
            logger.info(f"Scan timeout: {self.scan_timeout} minutes ({timeout_seconds} seconds)")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_seconds
            )
            
            if result.returncode != 0:
                logger.warning(f"ScoutSuite stderr: {result.stderr}")
            
            # Parse ScoutSuite JSON report
            report_file = report_dir / f"scoutsuite-results/scoutsuite_results_{report_name}.js"
            
            # ScoutSuite generates a JS file, we need to extract JSON
            if report_file.exists():
                with open(report_file, 'r') as f:
                    content = f.read()
                    # Extract JSON from JS file (format: scoutsuite_results = {...})
                    json_start = content.find('{')
                    json_end = content.rfind('}') + 1
                    if json_start > 0 and json_end > json_start:
                        scan_data = json.loads(content[json_start:json_end])
                    else:
                        scan_data = {}
            else:
                logger.warning("ScoutSuite report file not found, returning empty results")
                scan_data = {}
            
            # Format results
            formatted = {
                'tool': 'scoutsuite',
                'version': self._get_version(),
                'aws_account': self.aws_account,
                'aws_region': self.aws_region,
                'scan_timestamp': int(time.time()),
                'results': self._parse_findings(scan_data)
            }
            
            return formatted
            
        except subprocess.TimeoutExpired:
            return {'tool': 'scoutsuite', 'error': 'timeout', 'results': []}
        except Exception as e:
            logger.error(f"ScoutSuite execution error: {str(e)}")
            return {'tool': 'scoutsuite', 'error': str(e), 'results': []}
    
    def _parse_findings(self, scan_data: dict) -> list:
        """Parse ScoutSuite scan data and extract findings."""
        findings = []
        services = scan_data.get('services', {})
        
        for service_name, service_data in services.items():
            if not isinstance(service_data, dict):
                continue
            
            # Parse findings from service data
            findings_data = service_data.get('findings', {})
            
            for finding_key, finding_info in findings_data.items():
                if not isinstance(finding_info, dict):
                    continue
                
                # Extract finding details
                finding = {
                    'finding_id': f"{service_name}_{finding_key}_{uuid.uuid4().hex[:8]}",
                    'service': service_name,
                    'finding_key': finding_key,
                    'description': finding_info.get('description', ''),
                    'level': finding_info.get('level', 'info'),
                    'severity': self._map_severity(finding_info.get('level', 'info')),
                    'items': finding_info.get('items', []),
                    'items_count': len(finding_info.get('items', [])),
                    'compliance': finding_info.get('compliance', []),
                    'references': finding_info.get('references', [])
                }
                
                findings.append(finding)
        
        logger.info(f"Parsed {len(findings)} findings from ScoutSuite scan")
        return findings
    
    def _map_severity(self, level: str) -> str:
        """Map ScoutSuite levels to standard severity."""
        severity_map = {
            'danger': 'critical',
            'warning': 'high',
            'info': 'medium',
            'success': 'low'
        }
        return severity_map.get(level.lower(), 'medium')
    
    def _count_findings(self, results: dict) -> int:
        """Count total findings in results."""
        return len(results.get('results', []))
    
    def _get_version(self) -> str:
        """Get ScoutSuite version."""
        try:
            result = subprocess.run(['scout', '--version'], capture_output=True, text=True)
            return result.stdout.strip()
        except:
            return 'unknown'
    
    def _write_results(self, results: dict):
        """Write results to S3 and DynamoDB."""
        timestamp = int(time.time())
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        s3_key = f"tool-results/{self.tool_name}/{self.mission_id}/{timestamp}/results.json"
        
        # Upload to S3
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=s3_key,
            Body=results_json,
            ContentType='application/json',
            Metadata={
                'tool': self.tool_name,
                'digest': f"sha256:{digest}",
                'aws_account': self.aws_account,
                'aws_region': self.aws_region
            }
        )
        
        # Write to DynamoDB
        self.dynamodb_client.put_item(
            TableName=self.dynamodb_tool_results_table,
            Item={
                'mission_id': {'S': self.mission_id},
                'tool_timestamp': {'S': f"{self.tool_name}#{timestamp}"},
                'tool_name': {'S': self.tool_name},
                's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                'digest': {'S': f"sha256:{digest}"},
                'findings_count': {'N': str(len(results.get('results', [])))},
                'aws_account': {'S': self.aws_account},
                'aws_region': {'S': self.aws_region},
                'success': {'BOOL': True},
                'ttl': {'N': str(timestamp + (7 * 24 * 60 * 60))}
            }
        )
        
        logger.info(f"Results written to S3: {s3_key}")
    
    def _write_error(self, error: str):
        """Write error to DynamoDB."""
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
    server = ScoutSuiteMCPServer()
    return server.run()

if __name__ == "__main__":
    exit(main())