"""
ScoutSuite MCP Server - Proper Model Context Protocol Implementation
Implements JSON-RPC 2.0 protocol for AWS security configuration assessment.
"""

import os
import json
import asyncio
import hashlib
import boto3
import logging
from pathlib import Path
from typing import Any, Sequence
import time

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
    ImageContent,
    EmbeddedResource
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ScoutSuiteMCPServer:
    """MCP-compliant server for ScoutSuite AWS security assessment."""
    
    def __init__(self):
        self.server = Server("scoutsuite-mcp")
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        
        # Register MCP handlers
        self._register_handlers()
        
        logger.info(f"ScoutSuiteMCPServer initialized for mission: {self.mission_id}")
    
    def _register_handlers(self):
        """Register MCP protocol handlers."""
        
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List available tools - MCP protocol requirement."""
            return [
                Tool(
                    name="scoutsuite_scan",
                    description="Run comprehensive AWS security configuration assessment across all services. Scans IAM, S3, EC2, RDS, Lambda, and 20+ other AWS services for security misconfigurations, compliance violations, and best practice deviations.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "aws_profile": {
                                "type": "string",
                                "description": "AWS CLI profile name to use (optional, uses default credentials if not specified)",
                                "default": "default"
                            },
                            "services": {
                                "type": "array",
                                "description": "List of AWS services to scan (default: all). Options: iam, s3, ec2, rds, lambda, cloudtrail, etc.",
                                "items": {"type": "string"},
                                "default": []
                            },
                            "regions": {
                                "type": "array",
                                "description": "AWS regions to scan (default: all enabled regions)",
                                "items": {"type": "string"},
                                "default": []
                            },
                            "report_name": {
                                "type": "string",
                                "description": "Custom name for the assessment report",
                                "default": "aws-security-assessment"
                            },
                            "timeout": {
                                "type": "integer",
                                "description": "Scan timeout in seconds (default: 1800 = 30 minutes)",
                                "default": 1800
                            }
                        },
                        "required": []
                    }
                ),
                Tool(
                    name="get_compliance_report",
                    description="Retrieve compliance report from previous ScoutSuite scan with CIS AWS Foundations Benchmark mapping",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "mission_id": {
                                "type": "string",
                                "description": "Mission ID of the scan"
                            },
                            "format": {
                                "type": "string",
                                "description": "Report format: json or html",
                                "enum": ["json", "html"],
                                "default": "json"
                            }
                        },
                        "required": ["mission_id"]
                    }
                ),
                Tool(
                    name="get_scan_results",
                    description="Retrieve raw scan results from previous ScoutSuite assessment",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "mission_id": {
                                "type": "string",
                                "description": "Mission ID of the scan"
                            }
                        },
                        "required": ["mission_id"]
                    }
                )
            ]
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: Any) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
            """Execute tool - MCP protocol requirement."""
            try:
                if name == "scoutsuite_scan":
                    result = await self._execute_scoutsuite_scan(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2)
                    )]
                
                elif name == "get_compliance_report":
                    result = await self._get_compliance_report(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2) if isinstance(result, dict) else result
                    )]
                
                elif name == "get_scan_results":
                    result = await self._get_scan_results(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2)
                    )]
                
                else:
                    raise ValueError(f"Unknown tool: {name}")
                    
            except Exception as e:
                logger.error(f"Tool execution failed: {e}", exc_info=True)
                return [TextContent(
                    type="text",
                    text=json.dumps({
                        "error": str(e),
                        "tool": name,
                        "success": False
                    })
                )]
    
    async def _execute_scoutsuite_scan(self, arguments: dict) -> dict:
        """Execute ScoutSuite AWS security assessment with MCP protocol."""
        aws_profile = arguments.get("aws_profile", "default")
        services = arguments.get("services", [])
        regions = arguments.get("regions", [])
        report_name = arguments.get("report_name", "aws-security-assessment")
        timeout = arguments.get("timeout", 1800)
        
        logger.info(f"Starting ScoutSuite scan: profile={aws_profile}, services={services or 'all'}")
        
        # Execute ScoutSuite
        results = await self._run_scoutsuite(aws_profile, services, regions, report_name, timeout)
        
        # Return MCP-compliant response with results
        # Coordinator will handle storing to S3/DynamoDB
        return {
            "success": True,
            "tool": "scoutsuite",
            "mission_id": self.mission_id,
            "report_name": report_name,
            "findings_count": results.get('findings_count', 0),
            "results": results,
            "summary": results.get('summary', {})
        }
    
    async def _run_scoutsuite(
        self,
        aws_profile: str,
        services: list,
        regions: list,
        report_name: str,
        timeout: int
    ) -> dict:
        """Run ScoutSuite scan asynchronously."""
        try:
            output_dir = f'/tmp/scoutsuite-{self.mission_id}'
            Path(output_dir).mkdir(parents=True, exist_ok=True)
            
            # Build command
            cmd = [
                'scout',
                'aws',
                '--profile', aws_profile,
                '--report-dir', output_dir,
                '--report-name', report_name,
                '--no-browser',
                '--json'
            ]
            
            if services:
                cmd.extend(['--services'] + services)
            
            if regions:
                cmd.extend(['--regions'] + regions)
            
            # Run ScoutSuite
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, 'AWS_PROFILE': aws_profile}
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
            
            if process.returncode == 0:
                # Parse ScoutSuite results
                results_file = Path(output_dir) / f'scoutsuite-results/scoutsuite_results_aws-{report_name}.js'
                
                if results_file.exists():
                    # ScoutSuite outputs JS file, need to extract JSON
                    content = results_file.read_text()
                    # Extract JSON from: scoutsuite_results = {...};
                    json_start = content.find('{')
                    json_end = content.rfind('}') + 1
                    if json_start > 0 and json_end > json_start:
                        results_json = content[json_start:json_end]
                        scout_data = json.loads(results_json)
                    else:
                        scout_data = {}
                else:
                    scout_data = {}
                
                # Format results
                formatted = {
                    'tool': 'scoutsuite',
                    'version': await self._get_scoutsuite_version(),
                    'profile': aws_profile,
                    'report_name': report_name,
                    'findings_count': self._count_findings(scout_data),
                    'summary': self._create_summary(scout_data),
                    'raw_results': scout_data
                }
                
                return formatted
            else:
                raise Exception(f"ScoutSuite failed with code {process.returncode}: {stderr.decode()}")
                
        except asyncio.TimeoutError:
            logger.error(f"ScoutSuite timeout after {timeout} seconds")
            return {
                'tool': 'scoutsuite',
                'error': 'timeout',
                'findings_count': 0
            }
    
    async def _get_scoutsuite_version(self) -> str:
        """Get ScoutSuite version asynchronously."""
        try:
            process = await asyncio.create_subprocess_exec(
                'scout',
                '--version',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            return stdout.decode().strip()
        except:
            return 'unknown'
    
    def _count_findings(self, scout_data: dict) -> int:
        """Count total findings from ScoutSuite results."""
        count = 0
        services = scout_data.get('services', {})
        
        for service_name, service_data in services.items():
            findings = service_data.get('findings', {})
            for finding_name, finding_data in findings.items():
                flagged_items = finding_data.get('flagged_items', [])
                count += len(flagged_items)
        
        return count
    
    def _create_summary(self, scout_data: dict) -> dict:
        """Create summary from ScoutSuite results."""
        services = scout_data.get('services', {})
        summary = {
            'services_scanned': len(services),
            'by_severity': {'danger': 0, 'warning': 0, 'info': 0},
            'by_service': {}
        }
        
        for service_name, service_data in services.items():
            service_findings = 0
            findings = service_data.get('findings', {})
            
            for finding_name, finding_data in findings.items():
                flagged_items = finding_data.get('flagged_items', [])
                finding_count = len(flagged_items)
                service_findings += finding_count
                
                # Count by severity
                severity = finding_data.get('level', 'info')
                if severity in summary['by_severity']:
                    summary['by_severity'][severity] += finding_count
            
            summary['by_service'][service_name] = service_findings
        
        return summary
    
    async def _store_results(self, results: dict, report_name: str) -> dict:
        """Store results in S3 and DynamoDB with evidence chain."""
        timestamp = int(time.time())
        
        # Compute digest
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        
        # Write to S3
        s3_key = f"tool-results/scoutsuite-mcp/{self.mission_id}/{timestamp}/{report_name}-results.json"
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=s3_key,
                Body=results_json,
                ContentType='application/json',
                Metadata={
                    'tool': 'scoutsuite-mcp',
                    'mission-id': self.mission_id,
                    'digest': f"sha256:{digest}",
                    'report-name': report_name
                }
            )
        )
        
        # Write digest file
        digest_key = f"tool-results/scoutsuite-mcp/{self.mission_id}/{timestamp}/digest.sha256"
        await loop.run_in_executor(
            None,
            lambda: self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=digest_key,
                Body=f"sha256:{digest}",
                ContentType='text/plain'
            )
        )
        
        # Index in DynamoDB
        await loop.run_in_executor(
            None,
            lambda: self.dynamodb_client.put_item(
                TableName=self.dynamodb_tool_results_table,
                Item={
                    'mission_id': {'S': self.mission_id},
                    'tool_timestamp': {'S': f"scoutsuite-mcp#{timestamp}"},
                    'tool_name': {'S': 'scoutsuite-mcp'},
                    's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                    'digest': {'S': f"sha256:{digest}"},
                    'findings_count': {'N': str(results.get('findings_count', 0))},
                    'success': {'BOOL': True},
                    'report_name': {'S': report_name},
                    'ttl': {'N': str(timestamp + (7 * 24 * 60 * 60))}
                }
            )
        )
        
        logger.info(f"Results stored: s3://{self.s3_artifacts_bucket}/{s3_key}")
        logger.info(f"Evidence chain digest: sha256:{digest}")
        
        return {
            "s3_uri": f"s3://{self.s3_artifacts_bucket}/{s3_key}",
            "digest": f"sha256:{digest}",
            "timestamp": timestamp
        }
    
    async def _get_compliance_report(self, arguments: dict) -> dict:
        """Retrieve compliance report from DynamoDB."""
        mission_id = arguments.get("mission_id", self.mission_id)
        format_type = arguments.get("format", "json")
        
        # Get raw results first
        results = await self._get_scan_results({"mission_id": mission_id})
        
        if "error" in results:
            return results
        
        # Extract compliance-relevant findings
        compliance_report = {
            "mission_id": mission_id,
            "report_type": "cis_aws_foundations_benchmark",
            "findings_by_control": {},
            "summary": results.get('summary', {})
        }
        
        # Map ScoutSuite findings to CIS controls
        # This is a simplified version - production would have full CIS mapping
        raw_results = results.get('raw_results', {})
        services = raw_results.get('services', {})
        
        for service_name, service_data in services.items():
            findings = service_data.get('findings', {})
            for finding_name, finding_data in findings.items():
                compliance_report['findings_by_control'][finding_name] = {
                    'service': service_name,
                    'severity': finding_data.get('level', 'info'),
                    'flagged_items_count': len(finding_data.get('flagged_items', [])),
                    'description': finding_data.get('description', '')
                }
        
        return compliance_report
    
    async def _get_scan_results(self, arguments: dict) -> dict:
        """Retrieve scan results from DynamoDB."""
        mission_id = arguments.get("mission_id", self.mission_id)
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self.dynamodb_client.query(
                TableName=self.dynamodb_tool_results_table,
                KeyConditionExpression='mission_id = :mid AND begins_with(tool_timestamp, :tool)',
                ExpressionAttributeValues={
                    ':mid': {'S': mission_id},
                    ':tool': {'S': 'scoutsuite-mcp#'}
                }
            )
        )
        
        items = response.get('Items', [])
        if not items:
            return {"error": "No results found", "mission_id": mission_id}
        
        # Get most recent result
        latest = items[-1]
        s3_uri = latest['s3_uri']['S']
        
        # Download from S3
        if s3_uri.startswith('s3://'):
            bucket, key = s3_uri[5:].split('/', 1)
            obj = await loop.run_in_executor(
                None,
                lambda: self.s3_client.get_object(Bucket=bucket, Key=key)
            )
            content = obj['Body'].read().decode()
            return json.loads(content)
        
        return {"error": "Invalid S3 URI", "s3_uri": s3_uri}
    
    async def run(self):
        """Start MCP server with stdio transport."""
        async with stdio_server() as (read_stream, write_stream):
            logger.info("ScoutSuite MCP Server starting with stdio transport")
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )


async def main():
    """Entry point for MCP server."""
    server = ScoutSuiteMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())