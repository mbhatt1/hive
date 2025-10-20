"""
Pacu MCP Server - AWS Exploit Validation
Validates if AWS security findings are actually exploitable
"""

import os
import json
import subprocess
import hashlib
import boto3
import logging
from pathlib import Path
from typing import Dict, List
import time
import uuid
import sqlite3

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PacuMCPServer:
    def __init__(self):
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        self.tool_name = 'pacu-mcp'
        
        # AWS configuration for validation
        self.aws_account = os.environ.get('AWS_ACCOUNT_ID', '')
        self.aws_region = os.environ.get('AWS_TARGET_REGION', 'us-east-1')
        self.aws_profile = os.environ.get('AWS_PROFILE', 'default')
        
        # Findings to validate (JSON string)
        self.findings_json = os.environ.get('FINDINGS', '[]')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        
        # Pacu session configuration
        self.session_name = f"hivemind_{self.mission_id}"
        self.session_db = Path(f"/tmp/pacu_sessions/{self.session_name}.db")
        
        logger.info(f"PacuMCPServer initialized for mission: {self.mission_id}")
        logger.info(f"Target AWS Account: {self.aws_account}, Region: {self.aws_region}")
    
    def run(self):
        try:
            # Parse findings to validate
            findings = json.loads(self.findings_json)
            logger.info(f"Validating {len(findings)} findings")
            
            # Create Pacu session
            self._create_session()
            
            # Validate findings
            results = self._validate_findings(findings)
            
            # Write results
            self._write_results(results)
            
            validated_count = sum(1 for r in results.get('validations', []) if r.get('exploitable'))
            logger.info(f"Pacu validation completed: {validated_count}/{len(findings)} exploitable")
            
            return 0
        except Exception as e:
            logger.error(f"Pacu validation failed: {str(e)}", exc_info=True)
            self._write_error(str(e))
            return 1
    
    def _create_session(self):
        """Create a new Pacu session."""
        try:
            # Ensure session directory exists
            self.session_db.parent.mkdir(parents=True, exist_ok=True)
            
            cmd = [
                'pacu',
                '--session', self.session_name
            ]
            
            # Set AWS credentials via environment
            env = os.environ.copy()
            if os.environ.get('AWS_ACCESS_KEY_ID') and os.environ.get('AWS_SECRET_ACCESS_KEY'):
                env['AWS_ACCESS_KEY_ID'] = os.environ.get('AWS_ACCESS_KEY_ID')
                env['AWS_SECRET_ACCESS_KEY'] = os.environ.get('AWS_SECRET_ACCESS_KEY')
                if os.environ.get('AWS_SESSION_TOKEN'):
                    env['AWS_SESSION_TOKEN'] = os.environ.get('AWS_SESSION_TOKEN')
            
            logger.info(f"Creating Pacu session: {self.session_name}")
            
            # Initialize session (this creates the SQLite database)
            result = subprocess.run(
                cmd + ['--list-modules'],
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            if result.returncode != 0:
                logger.warning(f"Pacu session creation warning: {result.stderr}")
            
            logger.info("Pacu session created successfully")
            
        except Exception as e:
            logger.error(f"Failed to create Pacu session: {str(e)}")
            raise
    
    def _validate_findings(self, findings: list) -> dict:
        """Validate findings using Pacu modules with intelligent selection.
        
        If priority_findings are provided (from Strategist's Claude analysis),
        use the recommended modules for each finding.
        """
        validations = []
        
        # Check if we have intelligent analysis from Strategist
        priority_findings_map = {}
        if isinstance(findings, dict) and 'priority_findings' in findings:
            # Extract priority findings with their recommended modules
            for pf in findings['priority_findings']:
                priority_findings_map[pf['finding_id']] = {
                    'priority_score': pf['priority_score'],
                    'recommended_modules': pf['recommended_modules'],
                    'rationale': pf.get('rationale', '')
                }
            logger.info(f"Using intelligent module selection for {len(priority_findings_map)} priority findings")
            findings_to_validate = findings.get('findings', findings.get('priority_findings', []))
        else:
            findings_to_validate = findings if isinstance(findings, list) else []
        
        for finding in findings_to_validate:
            try:
                finding_id = finding.get('finding_id')
                
                # Use intelligent module selection if available
                if finding_id in priority_findings_map:
                    priority_info = priority_findings_map[finding_id]
                    validation = self._validate_with_intelligent_modules(
                        finding,
                        priority_info['recommended_modules'],
                        priority_info['rationale']
                    )
                else:
                    # Fall back to rule-based validation
                    validation = self._validate_single_finding(finding)
                
                validations.append(validation)
            except Exception as e:
                logger.error(f"Failed to validate finding {finding.get('finding_id')}: {str(e)}")
                validations.append({
                    'finding_id': finding.get('finding_id'),
                    'status': 'error',
                    'error': str(e),
                    'exploitable': False
                })
        
        return {
            'tool': 'pacu',
            'version': self._get_version(),
            'session_name': self.session_name,
            'aws_account': self.aws_account,
            'aws_region': self.aws_region,
            'validation_timestamp': int(time.time()),
            'validations': validations
        }
    
    def _validate_with_intelligent_modules(
        self,
        finding: dict,
        recommended_modules: List[str],
        rationale: str
    ) -> dict:
        """Validate a finding using Claude-recommended Pacu modules."""
        finding_id = finding.get('finding_id')
        service = finding.get('service', '').lower()
        
        logger.info(f"Validating {finding_id} with intelligent modules: {recommended_modules}")
        logger.info(f"Rationale: {rationale}")
        
        # Try each recommended module in order
        for module in recommended_modules:
            if not module:
                continue
            
            result = self._run_pacu_module(module)
            
            # Analyze if this module confirmed exploitability
            if result and self._analyze_module_result(result, finding):
                return {
                    'finding_id': finding_id,
                    'service': service,
                    'module': module,
                    'status': 'completed',
                    'exploitable': True,
                    'evidence': result.get('output', ''),
                    'claude_rationale': rationale,
                    'validation_method': 'intelligent_claude_selection',
                    'executed_at': int(time.time())
                }
        
        # No modules confirmed exploitability
        return {
            'finding_id': finding_id,
            'service': service,
            'modules_tried': recommended_modules,
            'status': 'completed',
            'exploitable': False,
            'claude_rationale': rationale,
            'validation_method': 'intelligent_claude_selection',
            'executed_at': int(time.time())
        }
    
    def _validate_single_finding(self, finding: dict) -> dict:
        """Validate a single finding using appropriate Pacu module."""
        finding_id = finding.get('finding_id')
        service = finding.get('service', '').lower()
        finding_key = finding.get('finding_key', '')
        
        logger.info(f"Validating finding: {finding_id} (service: {service})")
        
        # Map finding to Pacu module
        module = self._map_finding_to_module(service, finding_key)
        
        if not module:
            return {
                'finding_id': finding_id,
                'service': service,
                'module': 'none',
                'status': 'skipped',
                'reason': 'No applicable Pacu module',
                'exploitable': False
            }
        
        # Run Pacu module
        result = self._run_pacu_module(module)
        
        # Analyze result to determine exploitability
        exploitable = self._analyze_module_result(result, finding)
        
        return {
            'finding_id': finding_id,
            'service': service,
            'module': module,
            'status': 'completed',
            'exploitable': exploitable,
            'evidence': result.get('output', ''),
            'executed_at': int(time.time())
        }
    
    def _map_finding_to_module(self, service: str, finding_key: str) -> str:
        """Map a finding to an appropriate Pacu module."""
        # Service-based module mapping
        service_modules = {
            'iam': 'iam__enum_permissions',
            's3': 's3__bucket_finder',
            'ec2': 'ec2__enum_instances',
            'lambda': 'lambda__enum',
            'rds': 'rds__enum',
            'kms': 'kms__enum',
            'cloudtrail': 'cloudtrail__download_event_history'
        }
        
        # Finding-specific overrides
        if 'policy' in finding_key.lower():
            return 'iam__enum_policies'
        elif 'bucket' in finding_key.lower():
            return 's3__bucket_finder'
        elif 'security-group' in finding_key.lower():
            return 'ec2__enum_security_groups'
        
        return service_modules.get(service, '')
    
    def _run_pacu_module(self, module_name: str) -> dict:
        """Run a Pacu module."""
        try:
            cmd = [
                'pacu',
                '--session', self.session_name,
                '--exec', module_name
            ]
            
            logger.info(f"Running Pacu module: {module_name}")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minutes per module
            )
            
            return {
                'module': module_name,
                'returncode': result.returncode,
                'output': result.stdout,
                'errors': result.stderr,
                'success': result.returncode == 0
            }
            
        except subprocess.TimeoutExpired:
            logger.warning(f"Pacu module {module_name} timed out")
            return {
                'module': module_name,
                'returncode': -1,
                'output': '',
                'errors': 'Module execution timed out',
                'success': False
            }
        except Exception as e:
            logger.error(f"Failed to run Pacu module {module_name}: {str(e)}")
            return {
                'module': module_name,
                'returncode': -1,
                'output': '',
                'errors': str(e),
                'success': False
            }
    
    def _analyze_module_result(self, result: dict, finding: dict) -> bool:
        """Analyze Pacu module result to determine exploitability."""
        if not result.get('success'):
            return False
        
        output = result.get('output', '').lower()
        
        # Exploitation indicators
        exploit_indicators = [
            'found',
            'discovered',
            'vulnerable',
            'exploitable',
            'accessible',
            'exposed',
            'permission granted',
            'successfully enumerated',
            'retrieved'
        ]
        
        # Negative indicators
        negative_indicators = [
            'no results',
            'not found',
            'access denied',
            'permission denied',
            'unauthorized',
            'failed',
            'error'
        ]
        
        # Count indicators
        exploit_count = sum(1 for indicator in exploit_indicators if indicator in output)
        negative_count = sum(1 for indicator in negative_indicators if indicator in output)
        
        # Finding is exploitable if we have more positive indicators
        return exploit_count > negative_count and exploit_count > 0
    
    def _get_version(self) -> str:
        """Get Pacu version."""
        try:
            result = subprocess.run(['pacu', '--version'], capture_output=True, text=True)
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
                'aws_region': self.aws_region,
                'session_name': self.session_name
            }
        )
        
        # Count exploitable findings
        exploitable_count = sum(
            1 for v in results.get('validations', []) 
            if v.get('exploitable')
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
                'findings_count': {'N': str(len(results.get('validations', [])))},
                'exploitable_count': {'N': str(exploitable_count)},
                'aws_account': {'S': self.aws_account},
                'aws_region': {'S': self.aws_region},
                'session_name': {'S': self.session_name},
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
    server = PacuMCPServer()
    return server.run()

if __name__ == "__main__":
    exit(main())