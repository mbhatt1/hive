"""
Pacu MCP Server - Proper Model Context Protocol Implementation
Implements JSON-RPC 2.0 protocol for AWS penetration testing.
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


class PacuMCPServer:
    """MCP-compliant server for Pacu AWS penetration testing."""
    
    def __init__(self):
        self.server = Server("pacu-mcp")
        self.mission_id = os.environ.get('MISSION_ID', 'test-scan-123')
        
        # Register MCP handlers
        self._register_handlers()
        
        logger.info(f"PacuMCPServer initialized for mission: {self.mission_id}")
    
    def _register_handlers(self):
        """Register MCP protocol handlers."""
        
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List available tools - MCP protocol requirement."""
            return [
                Tool(
                    name="pacu_list_modules",
                    description="List all available Pacu modules for AWS penetration testing. Modules include reconnaissance, privilege escalation, lateral movement, and exfiltration techniques.",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "category": {
                                "type": "string",
                                "description": "Filter by module category: recon, enum, privesc, lateral, exfil, or all",
                                "default": "all",
                                "enum": ["all", "recon", "enum", "privesc", "lateral", "exfil"]
                            }
                        },
                        "required": []
                    }
                ),
                Tool(
                    name="pacu_run_module",
                    description="Execute a specific Pacu module for AWS penetration testing with safety controls",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "module_name": {
                                "type": "string",
                                "description": "Name of the Pacu module to run (e.g., 'iam__enum_permissions', 'ec2__enum')"
                            },
                            "aws_profile": {
                                "type": "string",
                                "description": "AWS CLI profile to use",
                                "default": "default"
                            },
                            "regions": {
                                "type": "array",
                                "description": "AWS regions to target",
                                "items": {"type": "string"},
                                "default": []
                            },
                            "module_args": {
                                "type": "object",
                                "description": "Module-specific arguments",
                                "default": {}
                            },
                            "dry_run": {
                                "type": "boolean",
                                "description": "Perform dry run without making changes (recommended)",
                                "default": True
                            },
                            "timeout": {
                                "type": "integer",
                                "description": "Module execution timeout in seconds",
                                "default": 600
                            }
                        },
                        "required": ["module_name"]
                    }
                ),
                Tool(
                    name="pacu_enum_permissions",
                    description="Enumerate IAM permissions for current AWS credentials - safe reconnaissance module",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "aws_profile": {
                                "type": "string",
                                "description": "AWS CLI profile to use",
                                "default": "default"
                            }
                        },
                        "required": []
                    }
                )
            ]
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: Any) -> Sequence[TextContent | ImageContent | EmbeddedResource]:
            """Execute tool - MCP protocol requirement."""
            try:
                if name == "pacu_list_modules":
                    result = await self._list_pacu_modules(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2)
                    )]
                
                elif name == "pacu_run_module":
                    result = await self._run_pacu_module(arguments)
                    return [TextContent(
                        type="text",
                        text=json.dumps(result, indent=2)
                    )]
                
                elif name == "pacu_enum_permissions":
                    result = await self._enum_permissions(arguments)
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
    
    async def _list_pacu_modules(self, arguments: dict) -> dict:
        """List available Pacu modules."""
        category = arguments.get("category", "all")
        
        logger.info(f"Listing Pacu modules: category={category}")
        
        try:
            # Run pacu to list modules
            process = await asyncio.create_subprocess_exec(
                'pacu',
                '--list-modules',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=30
            )
            
            if process.returncode == 0:
                # Parse module list
                modules_text = stdout.decode()
                modules = []
                
                for line in modules_text.split('\n'):
                    line = line.strip()
                    if line and not line.startswith('#'):
                        # Simple parsing - production would be more sophisticated
                        if '__' in line:
                            module_name = line.split()[0] if ' ' in line else line
                            modules.append({
                                'name': module_name,
                                'category': self._categorize_module(module_name)
                            })
                
                # Filter by category if specified
                if category != "all":
                    modules = [m for m in modules if m['category'] == category]
                
                return {
                    "success": True,
                    "tool": "pacu",
                    "category": category,
                    "modules": modules,
                    "count": len(modules)
                }
            else:
                raise Exception(f"Pacu list modules failed: {stderr.decode()}")
                
        except asyncio.TimeoutError:
            return {"success": False, "error": "timeout listing modules"}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _categorize_module(self, module_name: str) -> str:
        """Categorize module by name convention."""
        if 'enum' in module_name or 'list' in module_name:
            return 'enum'
        elif 'priv' in module_name or 'escalate' in module_name:
            return 'privesc'
        elif 'lateral' in module_name:
            return 'lateral'
        elif 'exfil' in module_name:
            return 'exfil'
        else:
            return 'recon'
    
    async def _run_pacu_module(self, arguments: dict) -> dict:
        """Execute a Pacu module with MCP protocol."""
        module_name = arguments.get("module_name")
        aws_profile = arguments.get("aws_profile", "default")
        regions = arguments.get("regions", [])
        module_args = arguments.get("module_args", {})
        dry_run = arguments.get("dry_run", True)
        timeout = arguments.get("timeout", 600)
        
        logger.info(f"Running Pacu module: {module_name}, dry_run={dry_run}")
        
        # Safety check
        if not dry_run:
            logger.warning(f"PACU NON-DRY-RUN MODE: Module {module_name} will make real changes!")
        
        try:
            # Create Pacu session directory
            session_dir = f'/tmp/pacu-{self.mission_id}'
            Path(session_dir).mkdir(parents=True, exist_ok=True)
            
            # Build command
            cmd = [
                'pacu',
                '--session', self.mission_id,
                '--profile', aws_profile
            ]
            
            if regions:
                cmd.extend(['--regions', ','.join(regions)])
            
            # Add module execution
            cmd.extend(['--exec', module_name])
            
            # Add dry run flag if requested
            if dry_run:
                cmd.append('--dry-run')
            
            # Run Pacu
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, 'AWS_PROFILE': aws_profile},
                cwd=session_dir
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )
            
            if process.returncode in [0, 1]:  # 0 = success, 1 = module errors (non-fatal)
                output = stdout.decode()
                
                # Parse Pacu output
                results = {
                    'tool': 'pacu',
                    'version': await self._get_pacu_version(),
                    'module': module_name,
                    'dry_run': dry_run,
                    'profile': aws_profile,
                    'output': output,
                    'summary': self._parse_pacu_output(output)
                }
                
                # Return MCP-compliant response with results
                # Coordinator will handle storing to S3/DynamoDB
                return {
                    "success": True,
                    "tool": "pacu",
                    "module": module_name,
                    "dry_run": dry_run,
                    "mission_id": self.mission_id,
                    "results": results,
                    "summary": results['summary']
                }
            else:
                raise Exception(f"Pacu module failed: {stderr.decode()}")
                
        except asyncio.TimeoutError:
            logger.error(f"Pacu module timeout after {timeout} seconds")
            return {"success": False, "error": "timeout", "module": module_name}
    
    async def _enum_permissions(self, arguments: dict) -> dict:
        """Safe IAM permission enumeration."""
        aws_profile = arguments.get("aws_profile", "default")
        
        logger.info(f"Enumerating IAM permissions for profile: {aws_profile}")
        
        # Run safe reconnaissance module
        return await self._run_pacu_module({
            "module_name": "iam__enum_permissions",
            "aws_profile": aws_profile,
            "dry_run": True,  # Always dry run for enum
            "timeout": 300
        })
    
    async def _get_pacu_version(self) -> str:
        """Get Pacu version asynchronously."""
        try:
            process = await asyncio.create_subprocess_exec(
                'pacu',
                '--version',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            return stdout.decode().strip()
        except Exception:
            return 'unknown'
    
    def _parse_pacu_output(self, output: str) -> dict:
        """Parse Pacu module output for key findings."""
        summary = {
            'lines': len(output.split('\n')),
            'errors': output.count('ERROR'),
            'warnings': output.count('WARNING'),
            'findings': []
        }
        
        # Extract key findings (simplified)
        for line in output.split('\n'):
            if 'Found' in line or 'Discovered' in line:
                summary['findings'].append(line.strip())
        
        return summary
    
    async def _store_results(self, results: dict, module_name: str) -> dict:
        """Store results in S3 and DynamoDB with evidence chain."""
        timestamp = int(time.time())
        
        # Compute digest
        results_json = json.dumps(results, sort_keys=True)
        digest = hashlib.sha256(results_json.encode()).hexdigest()
        
        # Write to S3
        s3_key = f"tool-results/pacu-mcp/{self.mission_id}/{timestamp}/{module_name}-results.json"
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.s3_client.put_object(
                Bucket=self.s3_artifacts_bucket,
                Key=s3_key,
                Body=results_json,
                ContentType='application/json',
                Metadata={
                    'tool': 'pacu-mcp',
                    'mission-id': self.mission_id,
                    'digest': f"sha256:{digest}",
                    'module-name': module_name
                }
            )
        )
        
        # Write digest file
        digest_key = f"tool-results/pacu-mcp/{self.mission_id}/{timestamp}/digest.sha256"
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
        findings_count = len(results.get('summary', {}).get('findings', []))
        await loop.run_in_executor(
            None,
            lambda: self.dynamodb_client.put_item(
                TableName=self.dynamodb_tool_results_table,
                Item={
                    'mission_id': {'S': self.mission_id},
                    'tool_timestamp': {'S': f"pacu-mcp#{timestamp}"},
                    'tool_name': {'S': 'pacu-mcp'},
                    's3_uri': {'S': f"s3://{self.s3_artifacts_bucket}/{s3_key}"},
                    'digest': {'S': f"sha256:{digest}"},
                    'findings_count': {'N': str(findings_count)},
                    'success': {'BOOL': True},
                    'module_name': {'S': module_name},
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
            logger.info("Pacu MCP Server starting with stdio transport")
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )


async def main():
    """Entry point for MCP server."""
    server = PacuMCPServer()
    await server.run()


if __name__ == "__main__":
    asyncio.run(main())