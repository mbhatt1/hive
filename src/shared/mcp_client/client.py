"""
MCP Client - Model Context Protocol Client for Agent Communication
Provides async interface for agents to communicate with MCP tool servers.
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional
from pathlib import Path
import subprocess

from mcp.client.session import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

logger = logging.getLogger(__name__)


class MCPToolClient:
    """
    Client for communicating with MCP tool servers using stdio transport.
    
    This client enables agents to:
    1. List available tools from MCP servers
    2. Call tools with proper JSON-RPC protocol
    3. Manage server lifecycle
    """
    
    def __init__(self, server_name: str, command: List[str], env: Optional[Dict[str, str]] = None):
        """
        Initialize MCP client for a specific tool server.
        
        Args:
            server_name: Name of the MCP server (e.g., 'semgrep-mcp')
            command: Command to launch the server (e.g., ['python', 'server.py'])
            env: Environment variables to pass to the server
        """
        self.server_name = server_name
        self.command = command
        self.env = env or {}
        self.session: Optional[ClientSession] = None
        self._read_stream = None
        self._write_stream = None
        
        logger.info(f"MCPToolClient initialized for {server_name}")
    
    async def connect(self):
        """Establish connection to MCP server via stdio."""
        try:
            # Create stdio server parameters
            server_params = StdioServerParameters(
                command=self.command[0],
                args=self.command[1:],
                env=self.env
            )
            
            # Connect using stdio transport
            self._read_stream, self._write_stream = await stdio_client(server_params)
            
            # Create session
            self.session = ClientSession(self._read_stream, self._write_stream)
            
            # Initialize session
            await self.session.initialize()
            
            logger.info(f"Connected to MCP server: {self.server_name}")
            
        except Exception as e:
            logger.error(f"Failed to connect to {self.server_name}: {e}", exc_info=True)
            raise
    
    async def disconnect(self):
        """Close connection to MCP server."""
        if self.session:
            try:
                await self.session.close()
                logger.info(f"Disconnected from {self.server_name}")
            except Exception as e:
                logger.warning(f"Error during disconnect from {self.server_name}: {e}")
            finally:
                self.session = None
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """
        List available tools from the MCP server.
        
        Returns:
            List of tool definitions with name, description, and input schema
        """
        if not self.session:
            raise RuntimeError(f"Not connected to {self.server_name}. Call connect() first.")
        
        try:
            result = await self.session.list_tools()
            tools = []
            
            for tool in result.tools:
                tools.append({
                    'name': tool.name,
                    'description': tool.description,
                    'inputSchema': tool.inputSchema
                })
            
            logger.info(f"Listed {len(tools)} tools from {self.server_name}")
            return tools
            
        except Exception as e:
            logger.error(f"Failed to list tools from {self.server_name}: {e}", exc_info=True)
            raise
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """
        Call a tool on the MCP server.
        
        Args:
            tool_name: Name of the tool to invoke
            arguments: Tool arguments as dictionary
            
        Returns:
            Tool execution result
        """
        if not self.session:
            raise RuntimeError(f"Not connected to {self.server_name}. Call connect() first.")
        
        try:
            logger.info(f"Calling tool {tool_name} on {self.server_name} with args: {arguments}")
            
            result = await self.session.call_tool(tool_name, arguments)
            
            # Parse result content
            response = {
                'tool': tool_name,
                'server': self.server_name,
                'success': True,
                'content': []
            }
            
            for content in result.content:
                if hasattr(content, 'text'):
                    try:
                        # Try to parse as JSON
                        parsed = json.loads(content.text)
                        response['content'].append(parsed)
                    except json.JSONDecodeError:
                        # Return as plain text
                        response['content'].append({'type': 'text', 'text': content.text})
                elif hasattr(content, 'data'):
                    response['content'].append({
                        'type': 'image',
                        'data': content.data,
                        'mimeType': getattr(content, 'mimeType', 'image/png')
                    })
            
            logger.info(f"Tool {tool_name} executed successfully")
            return response
            
        except Exception as e:
            logger.error(f"Failed to call tool {tool_name} on {self.server_name}: {e}", exc_info=True)
            return {
                'tool': tool_name,
                'server': self.server_name,
                'success': False,
                'error': str(e)
            }
    
    async def __aenter__(self):
        """Context manager entry."""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        await self.disconnect()


class MCPToolRegistry:
    """
    Registry of available MCP tool servers.
    Manages multiple tool connections and provides unified interface.
    """
    
    def __init__(self, base_env: Optional[Dict[str, str]] = None):
        """
        Initialize tool registry.
        
        Args:
            base_env: Base environment variables for all servers
        """
        self.base_env = base_env or {}
        self.clients: Dict[str, MCPToolClient] = {}
        self._server_configs = self._load_server_configs()
    
    def _load_server_configs(self) -> Dict[str, Dict[str, Any]]:
        """Load MCP server configurations."""
        import os
        mcp_base = os.environ.get('MCP_SERVERS_PATH', '/app/src/mcp_servers')
        return {
            'semgrep-mcp': {
                'command': ['python', f'{mcp_base}/semgrep_mcp/server.py'],
                'description': 'SAST security scanning with Semgrep'
            },
            'gitleaks-mcp': {
                'command': ['python', f'{mcp_base}/gitleaks_mcp/server.py'],
                'description': 'Secret and credential detection'
            },
            'trivy-mcp': {
                'command': ['python', f'{mcp_base}/trivy_mcp/server.py'],
                'description': 'Container and dependency vulnerability scanning'
            },
            'scoutsuite-mcp': {
                'command': ['python', f'{mcp_base}/scoutsuite_mcp/server.py'],
                'description': 'AWS security configuration assessment'
            },
            'pacu-mcp': {
                'command': ['python', f'{mcp_base}/pacu_mcp/server.py'],
                'description': 'AWS penetration testing framework'
            }
        }
    
    async def get_client(self, server_name: str, env: Optional[Dict[str, str]] = None) -> MCPToolClient:
        """
        Get or create MCP client for a server.
        
        Args:
            server_name: Name of the MCP server
            env: Additional environment variables
            
        Returns:
            Connected MCP client
        """
        if server_name not in self._server_configs:
            raise ValueError(f"Unknown MCP server: {server_name}")
        
        # Check if client already exists and is connected
        if server_name in self.clients and self.clients[server_name].session:
            return self.clients[server_name]
        
        # Create new client
        config = self._server_configs[server_name]
        merged_env = {**self.base_env, **(env or {})}
        
        client = MCPToolClient(
            server_name=server_name,
            command=config['command'],
            env=merged_env
        )
        
        await client.connect()
        self.clients[server_name] = client
        
        return client
    
    async def list_all_tools(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        List all tools from all available MCP servers.
        
        Returns:
            Dictionary mapping server names to their tool lists
        """
        all_tools = {}
        
        for server_name in self._server_configs.keys():
            try:
                client = await self.get_client(server_name)
                tools = await client.list_tools()
                all_tools[server_name] = tools
            except Exception as e:
                logger.error(f"Failed to list tools from {server_name}: {e}")
                all_tools[server_name] = []
        
        return all_tools
    
    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
        env: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Call a tool on a specific MCP server.
        
        Args:
            server_name: Name of the MCP server
            tool_name: Name of the tool to call
            arguments: Tool arguments
            env: Additional environment variables
            
        Returns:
            Tool execution result
        """
        client = await self.get_client(server_name, env)
        return await client.call_tool(tool_name, arguments)
    
    async def disconnect_all(self):
        """Disconnect from all MCP servers."""
        for server_name, client in self.clients.items():
            try:
                await client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting from {server_name}: {e}")
        
        self.clients.clear()
    
    async def __aenter__(self):
        """Context manager entry."""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        await self.disconnect_all()