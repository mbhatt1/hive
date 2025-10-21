"""
Semgrep MCP Server - Proper Model Context Protocol Implementation
Implements JSON-RPC 2.0 protocol for security scanning tool integration.
"""

import os
import json
import subprocess
import hashlib
import asyncio
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
    EmbeddedResource,
    INVALID_PARAMS,
    INTERNAL_ERROR
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SemgrepMCPServer:
    """MCP-compliant server for Semgrep security scanning."""
    
    def __init__(self):
        self.server = Server("semgrep-mcp")
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        
        # Register MCP handlers
        self._register_handlers()
        
        logger.info(f"SemgrepMCPServer initialized for mission: {self.mission_id}")
    
    def _register_handlers(self):
        """Register MCP protocol handlers."""
        
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List available tools - MCP protocol requirement."""
            return [
                Tool(
                    name="semgrep_scan",
                    description="Run Semgrep SAST (Static Application Security Testing) analysis on source code. Detects security vulnerabilities, code quality issues, and compliance violations using pattern-based rules.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "source_path": {
                                "type": "string",
                                "description": "Local filesystem path or S3 prefix to scan"
                            },
                            "config": {
                                "type": "string",
                                "description": "Semgrep config/ruleset (default: 'auto' for p/security-audit)",
                                "default": "auto"
                            },
                            "timeout": {
                                "type": "integer",
                                "description": "Scan timeout in seconds (default: 300)",
                                "default": 300
                            }
                        },
                        "required": ["source_path"]
                    }
                ),
                Tool(
                    name="get_scan_results",
                    description="Retrieve previously executed Semgrep scan results from S3 storage",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "mission_id": {
                                "type": "string",
                                "description": "Mission ID of the scan"
                            },
                            "result_uri": {
                                "type": "string",
                                "description": "S3 URI to the results file"
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
                if name == "semgrep_scan":
                    result = await self._execute_semgrep_scan(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2)
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
    
    async def _execute_semgrep_scan(self, arguments: dict) -> dict:
        """Execute Semgrep scan with MCP protocol."""
        source_path = arguments.get("source_path")
        config = arguments.get("config", "auto")
        timeout = arguments.get("timeout", 300)
        
        logger.info(f"Starting Semgrep scan: path={source_path}, config={config}")
        
        # Download source if S3 path
        if source_path.startswith("s3://") or source_path.startswith("unzipped/"):
            local_path = await self._download_source_from_s3(source_path)
        else:
            local_path = Path(source_path)
        
        # Execute Semgrep
        results = await self._run_semgrep(local_path, config, timeout)
        
        # Store results in S3 and DynamoDB
        storage_info = await self._store_results(results)
        
        # Return MCP-compliant response
        return {
            "success": True,
            "tool": "semgrep",
            "mission_id": self.mission_id,
            "findings_count": len(results.get('results', [])),
            "storage": storage_info,
            "summary": {
                "critical": sum(1 for r in results.get('results', []) if r.get('severity') == 'CRITICAL'),
                "high": sum(1 for r in results.get('results', []) if r.get('severity') == 'HIGH'),
                "medium": sum(1 for r in results.get('results', []) if r.get('severity') == 'MEDIUM'),
                "low": sum(1 for r in results.get('results', []) if r.get('severity') == 'LOW')
            }
        }
    
    async def _download_source_from_s3(self, s3_path: str) -> Path:
        """Download source code from S3 asynchronously."""
        # Remove s3:// prefix if present
        if s3_path.startswith("s3://"):
            s3_path = s3_path[5:]
            bucket, prefix = s3_path.split('/', 1)
        else:
            bucket = self.s3_artifacts_bucket
            prefix = s3_path
        
        local_path = Path(f"/tmp/{self.mission_id}")
        local_path.mkdir(parents=True, exist_ok=True)
        
        # Use asyncio to run S3 operations
        loop = asyncio.get_event_loop()
        
        paginator = self.s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                relative_path = key[len(prefix):].lstrip('/')
                
                if not relative_path:
                    continue
                
                file_path = local_path / relative_path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Run blocking S3 operation in executor
                await loop.run_in_executor(
                    None,
                    self.s3_client.download_file,
                    bucket,
                    key,
                    str(file_path)
                )
        
        logger.info(f"Downloaded source to {local_path}")
        return local_path
    
    async def _run_semgrep(self, source_path: Path, config: str, timeout: int) -> dict:
        """Run Semgrep scan asynchronously."""
        try:
            # Run Semgrep as subprocess asynchronously
            process = await asyncio.create_subprocess_exec(
                'semgrep',
                f'--config={config}',
                '--json',
                str(source_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
            
            if process.returncode in [0, 1]:  # 0 = clean, 1 = findings
                output = json.loads(stdout.decode())
                
                # Format results
                formatted = {
                    'tool': 'semgrep',
                    'version': await self._get_semgrep_version(),
                    'config': config,
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
                raise Exception(f"Semgrep failed with code {process.returncode}: {stderr.decode()}")
                
        except asyncio.TimeoutError:
            logger.error(f"Semgrep timeout after {timeout} seconds")
            return {'tool': 'semgrep', 'error': 'timeout', 'results': []}
    
    async def _get_semgrep_version(self) -> str:
        """Get Semgrep version asynchronously."""
        try:
            process = await asyncio.create_subprocess_exec(
                'semgrep',
                '--version',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            return stdout.decode().strip()
        except:
            return 'unknown'
    
    async def _store_results(self, results: dict) -> dict:
        """Store results in S3 and DynamoDB with evidence chain."""
        timestamp = int(time.time())
        
        # Compute cryptographic digest for evidence chain
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        
        # Write to S3
        s3_key = f"tool-results/semgrep-mcp/{self.mission_id}/{timestamp}/results.json"
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            self.s3_client.put_object,
            self.s3_artifacts_bucket,
            s3_key,
            results_json,
            'application/json',
            {'tool': 'semgrep-mcp', 'mission-id': self.mission_id, 'digest': f"sha256:{digest}"}
        )
        
        # Write digest file for evidence chain
        digest_key = f"tool-results/semgrep-mcp/{self.mission_id}/{timestamp}/digest.sha256"
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
                    'tool_timestamp': {'S': f"semgrep-mcp#{timestamp}"},
                    'tool_name': {'S': 'semgrep-mcp'},
                    's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                    'digest': {'S': f"sha256:{digest}"},
                    'findings_count': {'N': str(len(results.get('results', [])))},
                    'success': {'BOOL': True},
                    'execution_duration_ms': {'N': str(results.get('scan_duration_ms', 0))},
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
                    ':tool': {'S': 'semgrep-mcp#'}
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
                self.s3_client.get_object,
                bucket,
                key
            )
            content = obj['Body'].read().decode()
            return json.loads(content)
        
        return {"error": "Invalid S3 URI", "s3_uri": s3_uri}
    
    async def run(self):
        """Start MCP server with stdio transport."""
        async with stdio_server() as (read_stream, write_stream):
            logger.info("Semgrep MCP Server starting with stdio transport")
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )


async def main():
    """Entry point for MCP server."""
    server = SemgrepMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())