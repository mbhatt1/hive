"""
Trivy MCP Server - Proper Model Context Protocol Implementation
Implements JSON-RPC 2.0 protocol for container and dependency vulnerability scanning.
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


class TrivyMCPServer:
    """MCP-compliant server for Trivy vulnerability scanning."""
    
    def __init__(self):
        self.server = Server("trivy-mcp")
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        
        # Register MCP handlers
        self._register_handlers()
        
        logger.info(f"TrivyMCPServer initialized for mission: {self.mission_id}")
    
    def _register_handlers(self):
        """Register MCP protocol handlers."""
        
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List available tools - MCP protocol requirement."""
            return [
                Tool(
                    name="trivy_fs_scan",
                    description="Scan filesystem for vulnerabilities in dependencies, container images, and IaC misconfigurations. Detects CVEs, outdated packages, and security issues in Docker, Kubernetes, Terraform, and more.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "source_path": {
                                "type": "string",
                                "description": "Local filesystem path or S3 prefix to scan"
                            },
                            "scan_type": {
                                "type": "string",
                                "description": "Type of scan: vuln (vulnerabilities), config (misconfigurations), secret (secrets), or all",
                                "default": "vuln",
                                "enum": ["vuln", "config", "secret", "all"]
                            },
                            "severity": {
                                "type": "string",
                                "description": "Minimum severity level: CRITICAL, HIGH, MEDIUM, LOW, or UNKNOWN",
                                "default": "MEDIUM",
                                "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
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
                    name="trivy_image_scan",
                    description="Scan container image for vulnerabilities",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "image_name": {
                                "type": "string",
                                "description": "Container image name (e.g., 'alpine:3.18', 'nginx:latest')"
                            },
                            "severity": {
                                "type": "string",
                                "description": "Minimum severity level",
                                "default": "MEDIUM",
                                "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]
                            }
                        },
                        "required": ["image_name"]
                    }
                )
            ]
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: Any) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
            """Execute tool - MCP protocol requirement."""
            try:
                if name == "trivy_fs_scan":
                    result = await self._execute_fs_scan(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2)
                    )]
                
                elif name == "trivy_image_scan":
                    result = await self._execute_image_scan(arguments)
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
    
    async def _execute_fs_scan(self, arguments: dict) -> dict:
        """Execute Trivy filesystem scan with MCP protocol."""
        source_path = arguments.get("source_path")
        scan_type = arguments.get("scan_type", "vuln")
        severity = arguments.get("severity", "MEDIUM")
        timeout = arguments.get("timeout", 300)
        
        logger.info(f"Starting Trivy FS scan: path={source_path}, type={scan_type}, severity={severity}")
        
        # Source path is already local (downloaded by Coordinator)
        local_path = Path(source_path)
        
        if not local_path.exists():
            raise FileNotFoundError(f"Source path does not exist: {source_path}")
        
        # Execute Trivy
        results = await self._run_trivy_fs(local_path, scan_type, severity, timeout)
        
        # Return MCP-compliant response with results
        # Coordinator will handle storing to S3/DynamoDB
        return {
            "success": True,
            "tool": "trivy",
            "scan_type": "filesystem",
            "mission_id": self.mission_id,
            "vulnerabilities_found": len(results.get('results', [])),
            "results": results,
            "summary": self._create_summary(results)
        }
    
    async def _execute_image_scan(self, arguments: dict) -> dict:
        """Execute Trivy container image scan."""
        image_name = arguments.get("image_name")
        severity = arguments.get("severity", "MEDIUM")
        
        logger.info(f"Starting Trivy image scan: image={image_name}, severity={severity}")
        
        results = await self._run_trivy_image(image_name, severity)
        
        # Return MCP-compliant response with results
        # Coordinator will handle storing to S3/DynamoDB
        return {
            "success": True,
            "tool": "trivy",
            "scan_type": "image",
            "image_name": image_name,
            "vulnerabilities_found": len(results.get('results', [])),
            "results": results,
            "summary": self._create_summary(results)
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
    
    async def _run_trivy_fs(self, source_path: Path, scan_type: str, severity: str, timeout: int) -> dict:
        """Run Trivy filesystem scan asynchronously."""
        try:
            report_path = f'/tmp/trivy-report-{self.mission_id}.json'
            
            # Build command
            cmd = [
                'trivy',
                'fs',
                '--format', 'json',
                '--output', report_path,
                '--severity', severity
            ]
            
            if scan_type != "all":
                cmd.extend(['--scanners', scan_type])
            
            cmd.append(str(source_path))
            
            # Run Trivy
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
            
            if process.returncode in [0, 1]:  # 0 = clean, 1 = vulns found
                try:
                    with open(report_path, 'r') as f:
                        trivy_output = json.load(f)
                except Exception:
                    trivy_output = {}
                
                # Format results
                formatted = {
                    'tool': 'trivy',
                    'version': await self._get_trivy_version(),
                    'scan_type': scan_type,
                    'results': []
                }
                
                # Parse Trivy results
                for result in trivy_output.get('Results', []):
                    target = result.get('Target', '')
                    for vuln in result.get('Vulnerabilities', []):
                        formatted['results'].append({
                            'vulnerability_id': vuln.get('VulnerabilityID', ''),
                            'pkg_name': vuln.get('PkgName', ''),
                            'installed_version': vuln.get('InstalledVersion', ''),
                            'fixed_version': vuln.get('FixedVersion', 'N/A'),
                            'severity': vuln.get('Severity', 'UNKNOWN'),
                            'title': vuln.get('Title', ''),
                            'description': vuln.get('Description', ''),
                            'target': target
                        })
                
                return formatted
            else:
                raise Exception(f"Trivy failed with code {process.returncode}: {stderr.decode()}")
                
        except asyncio.TimeoutError:
            logger.error(f"Trivy timeout after {timeout} seconds")
            return {'tool': 'trivy', 'error': 'timeout', 'results': []}
    
    async def _run_trivy_image(self, image_name: str, severity: str) -> dict:
        """Run Trivy image scan asynchronously."""
        try:
            process = await asyncio.create_subprocess_exec(
                'trivy',
                'image',
                '--format', 'json',
                '--severity', severity,
                image_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode in [0, 1]:
                trivy_output = json.loads(stdout.decode())
                
                formatted = {
                    'tool': 'trivy',
                    'version': await self._get_trivy_version(),
                    'image': image_name,
                    'results': []
                }
                
                for result in trivy_output.get('Results', []):
                    target = result.get('Target', '')
                    for vuln in result.get('Vulnerabilities', []):
                        formatted['results'].append({
                            'vulnerability_id': vuln.get('VulnerabilityID', ''),
                            'pkg_name': vuln.get('PkgName', ''),
                            'installed_version': vuln.get('InstalledVersion', ''),
                            'fixed_version': vuln.get('FixedVersion', 'N/A'),
                            'severity': vuln.get('Severity', 'UNKNOWN'),
                            'title': vuln.get('Title', ''),
                            'target': target
                        })
                
                return formatted
            else:
                raise Exception(f"Trivy image scan failed: {stderr.decode()}")
        except Exception as e:
            logger.error(f"Trivy image scan error: {e}")
            return {'tool': 'trivy', 'error': str(e), 'results': []}
    
    async def _get_trivy_version(self) -> str:
        """Get Trivy version asynchronously."""
        try:
            process = await asyncio.create_subprocess_exec(
                'trivy',
                '--version',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            return stdout.decode().strip().split('\n')[0]
        except Exception:
            return 'unknown'
    
    def _create_summary(self, results: dict) -> dict:
        """Create vulnerability summary."""
        vulns = results.get('results', [])
        return {
            "total": len(vulns),
            "critical": sum(1 for v in vulns if v.get('severity') == 'CRITICAL'),
            "high": sum(1 for v in vulns if v.get('severity') == 'HIGH'),
            "medium": sum(1 for v in vulns if v.get('severity') == 'MEDIUM'),
            "low": sum(1 for v in vulns if v.get('severity') == 'LOW')
        }
    
    async def _store_results(self, results: dict, scan_type: str) -> dict:
        """Store results in S3 and DynamoDB with evidence chain."""
        timestamp = int(time.time())
        
        # Compute digest
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        
        # Write to S3
        s3_key = f"tool-results/trivy-mcp/{self.mission_id}/{timestamp}/{scan_type}-results.json"
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=s3_key,
                Body=results_json,
                ContentType='application/json',
                Metadata={
                    'tool': 'trivy-mcp',
                    'mission-id': self.mission_id,
                    'digest': f"sha256:{digest}",
                    'scan-type': scan_type
                }
            )
        )
        
        # Write digest file
        digest_key = f"tool-results/trivy-mcp/{self.mission_id}/{timestamp}/digest.sha256"
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
                    'tool_timestamp': {'S': f"trivy-mcp#{timestamp}"},
                    'tool_name': {'S': 'trivy-mcp'},
                    's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                    'digest': {'S': f"sha256:{digest}"},
                    'findings_count': {'N': str(len(results.get('results', [])))},
                    'success': {'BOOL': True},
                    'scan_type': {'S': scan_type},
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
    
    async def run(self):
        """Start MCP server with stdio transport."""
        async with stdio_server() as (read_stream, write_stream):
            logger.info("Trivy MCP Server starting with stdio transport")
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )


async def main():
    """Entry point for MCP server."""
    server = TrivyMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())