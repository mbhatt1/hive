"""
Gitleaks MCP Server - Proper Model Context Protocol Implementation
Implements JSON-RPC 2.0 protocol for secret and credential detection.
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


class GitleaksMCPServer:
    """MCP-compliant server for Gitleaks secret scanning."""
    
    def __init__(self):
        self.server = Server("gitleaks-mcp")
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'test-bucket')
        self.dynamodb_tool_results_table = os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', 'test-table')
        
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.s3_client = boto3.client('s3', region_name=region)
        self.dynamodb_client = boto3.client('dynamodb', region_name=region)
        
        # Register MCP handlers
        self._register_handlers()
        
        logger.info(f"GitleaksMCPServer initialized for mission: {self.mission_id}")
    
    def _register_handlers(self):
        """Register MCP protocol handlers."""
        
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List available tools - MCP protocol requirement."""
            return [
                Tool(
                    name="gitleaks_scan",
                    description="Detect hardcoded secrets, API keys, passwords, and credentials in source code. Scans for over 100 secret types including AWS keys, GitHub tokens, database passwords, and private keys.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "source_path": {
                                "type": "string",
                                "description": "Local filesystem path or S3 prefix to scan for secrets"
                            },
                            "config_path": {
                                "type": "string",
                                "description": "Optional path to custom Gitleaks config file",
                                "default": None
                            },
                            "timeout": {
                                "type": "integer",
                                "description": "Scan timeout in seconds (default: 180)",
                                "default": 180
                            },
                            "no_git": {
                                "type": "boolean",
                                "description": "Scan files without requiring Git repository (default: true)",
                                "default": True
                            }
                        },
                        "required": ["source_path"]
                    }
                ),
                Tool(
                    name="get_scan_results",
                    description="Retrieve previously executed Gitleaks scan results",
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
                if name == "gitleaks_scan":
                    result = await self._execute_gitleaks_scan(arguments)
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
    
    async def _execute_gitleaks_scan(self, arguments: dict) -> dict:
        """Execute Gitleaks scan with MCP protocol."""
        source_path = arguments.get("source_path")
        config_path = arguments.get("config_path")
        timeout = arguments.get("timeout", 180)
        no_git = arguments.get("no_git", True)
        
        logger.info(f"Starting Gitleaks scan: path={source_path}, timeout={timeout}")
        
        # Source path is already local (downloaded by Coordinator)
        local_path = Path(source_path)
        
        if not local_path.exists():
            raise FileNotFoundError(f"Source path does not exist: {source_path}")
        
        # Execute Gitleaks
        results = await self._run_gitleaks(local_path, config_path, timeout, no_git)
        
        # Return MCP-compliant response with results
        # Coordinator will handle storing to S3/DynamoDB
        return {
            "success": True,
            "tool": "gitleaks",
            "mission_id": self.mission_id,
            "secrets_found": len(results.get('results', [])),
            "results": results,
            "summary": {
                "total_secrets": len(results.get('results', [])),
                "unique_rules": len(set(r.get('rule_id') for r in results.get('results', []))),
                "files_with_secrets": len(set(r.get('file') for r in results.get('results', [])))
            }
        }
    
    async def _download_source_from_s3(self, s3_path: str) -> Path:
        """Download source code from S3 asynchronously."""
        if s3_path.startswith("s3://"):
            s3_path = s3_path[5:]
            bucket, prefix = s3_path.split('/', 1)
        else:
            bucket = self.s3_artifacts_bucket
            prefix = s3_path
        
        local_path = Path(f"/tmp/{self.mission_id}")
        local_path.mkdir(parents=True, exist_ok=True)
        
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
                
                await loop.run_in_executor(
                    None,
                    self.s3_client.download_file,
                    bucket,
                    key,
                    str(file_path)
                )
        
        logger.info(f"Downloaded source to {local_path}")
        return local_path
    
    async def _run_gitleaks(self, source_path: Path, config_path: str, timeout: int, no_git: bool) -> dict:
        """Run Gitleaks scan asynchronously."""
        try:
            report_path = f'/tmp/gitleaks-report-{self.mission_id}.json'
            
            # Build command
            cmd = [
                'gitleaks',
                'detect',
                '--source', str(source_path),
                '--report-format', 'json',
                '--report-path', report_path
            ]
            
            if no_git:
                cmd.append('--no-git')
            
            if config_path:
                cmd.extend(['--config', config_path])
            
            # Run Gitleaks as subprocess asynchronously
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
            
            # Gitleaks returns 1 if secrets found, 0 if clean
            if process.returncode in [0, 1]:
                try:
                    with open(report_path, 'r') as f:
                        findings = json.load(f)
                except:
                    findings = []
                
                # Format results
                formatted = {
                    'tool': 'gitleaks',
                    'version': await self._get_gitleaks_version(),
                    'results': []
                }
                
                for finding in findings:
                    formatted['results'].append({
                        'rule_id': finding.get('RuleID', 'unknown'),
                        'secret_type': finding.get('Description', 'unknown'),
                        'file': finding.get('File', ''),
                        'line_number': finding.get('StartLine', 0),
                        'match': finding.get('Match', ''),
                        'commit': finding.get('Commit', 'N/A'),
                        'author': finding.get('Author', 'N/A'),
                        'email': finding.get('Email', 'N/A'),
                        'date': finding.get('Date', 'N/A')
                    })
                
                return formatted
            else:
                raise Exception(f"Gitleaks failed with code {process.returncode}: {stderr.decode()}")
                
        except asyncio.TimeoutError:
            logger.error(f"Gitleaks timeout after {timeout} seconds")
            return {'tool': 'gitleaks', 'error': 'timeout', 'results': []}
    
    async def _get_gitleaks_version(self) -> str:
        """Get Gitleaks version asynchronously."""
        try:
            process = await asyncio.create_subprocess_exec(
                'gitleaks',
                'version',
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
        s3_key = f"tool-results/gitleaks-mcp/{self.mission_id}/{timestamp}/results.json"
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=s3_key,
                Body=results_json,
                ContentType='application/json',
                Metadata={
                    'tool': 'gitleaks-mcp',
                    'mission-id': self.mission_id,
                    'digest': f"sha256:{digest}"
                }
            )
        )
        
        # Write digest file for evidence chain
        digest_key = f"tool-results/gitleaks-mcp/{self.mission_id}/{timestamp}/digest.sha256"
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
                    'tool_timestamp': {'S': f"gitleaks-mcp#{timestamp}"},
                    'tool_name': {'S': 'gitleaks-mcp'},
                    's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                    'digest': {'S': f"sha256:{digest}"},
                    'findings_count': {'N': str(len(results.get('results', [])))},
                    'success': {'BOOL': True},
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
                    ':tool': {'S': 'gitleaks-mcp#'}
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
            logger.info("Gitleaks MCP Server starting with stdio transport")
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )


async def main():
    """Entry point for MCP server."""
    server = GitleaksMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())