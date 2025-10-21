"""
Integration Tests for Model Context Protocol Implementation
Tests MCP server communication, tool invocation, and evidence chains.
"""

import pytest
import asyncio
import json
import os
from pathlib import Path

from src.shared.mcp_client.client import MCPToolClient, MCPToolRegistry
from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel


class TestMCPProtocol:
    """Test MCP protocol compliance and communication."""
    
    @pytest.mark.asyncio
    async def test_semgrep_mcp_server_connection(self):
        """Test connection to Semgrep MCP server."""
        async with MCPToolClient(
            'semgrep-mcp',
            ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            env={'MISSION_ID': 'test-123', 'S3_ARTIFACTS_BUCKET': 'test-bucket'}
        ) as client:
            # Test list_tools
            tools = await client.list_tools()
            
            assert len(tools) >= 1
            assert any(t['name'] == 'semgrep_scan' for t in tools)
            
            # Verify tool schema
            semgrep_tool = next(t for t in tools if t['name'] == 'semgrep_scan')
            assert 'description' in semgrep_tool
            assert 'inputSchema' in semgrep_tool
            assert semgrep_tool['inputSchema']['type'] == 'object'
    
    @pytest.mark.asyncio
    async def test_gitleaks_mcp_server_connection(self):
        """Test connection to Gitleaks MCP server."""
        async with MCPToolClient(
            'gitleaks-mcp',
            ['python', 'src/mcp_servers/gitleaks_mcp/server.py'],
            env={'MISSION_ID': 'test-123'}
        ) as client:
            tools = await client.list_tools()
            
            assert len(tools) >= 1
            assert any(t['name'] == 'gitleaks_scan' for t in tools)
    
    @pytest.mark.asyncio
    async def test_trivy_mcp_server_connection(self):
        """Test connection to Trivy MCP server."""
        async with MCPToolClient(
            'trivy-mcp',
            ['python', 'src/mcp_servers/trivy_mcp/server.py'],
            env={'MISSION_ID': 'test-123'}
        ) as client:
            tools = await client.list_tools()
            
            assert len(tools) >= 2  # trivy_fs_scan and trivy_image_scan
            assert any(t['name'] == 'trivy_fs_scan' for t in tools)
            assert any(t['name'] == 'trivy_image_scan' for t in tools)
    
    @pytest.mark.asyncio
    async def test_mcp_tool_registry(self):
        """Test MCP tool registry management."""
        async with MCPToolRegistry(base_env={'MISSION_ID': 'test-123'}) as registry:
            # List all tools
            all_tools = await registry.list_all_tools()
            
            assert 'semgrep-mcp' in all_tools
            assert 'gitleaks-mcp' in all_tools
            assert 'trivy-mcp' in all_tools
            
            # Verify each server has tools
            for server_name, tools in all_tools.items():
                assert len(tools) > 0
                for tool in tools:
                    assert 'name' in tool
                    assert 'description' in tool
                    assert 'inputSchema' in tool


class TestMCPToolInvocation:
    """Test MCP tool invocation and results."""
    
    @pytest.mark.asyncio
    @pytest.mark.skipif(not Path('/tmp/test-code').exists(), reason="Test code directory not found")
    async def test_semgrep_scan_invocation(self):
        """Test Semgrep scan via MCP protocol."""
        async with MCPToolClient(
            'semgrep-mcp',
            ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            env={'MISSION_ID': 'test-scan', 'S3_ARTIFACTS_BUCKET': 'test-bucket'}
        ) as client:
            # Call semgrep_scan tool
            result = await client.call_tool('semgrep_scan', {
                'source_path': '/tmp/test-code',
                'config': 'auto',
                'timeout': 60
            })
            
            assert result['success'] == True
            assert result['server'] == 'semgrep-mcp'
            assert result['tool'] == 'semgrep_scan'
            assert 'content' in result
    
    @pytest.mark.asyncio
    async def test_mcp_error_handling(self):
        """Test MCP error handling for invalid arguments."""
        async with MCPToolClient(
            'semgrep-mcp',
            ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            env={'MISSION_ID': 'test-scan'}
        ) as client:
            # Call with invalid path
            result = await client.call_tool('semgrep_scan', {
                'source_path': '/nonexistent/path',
                'config': 'auto'
            })
            
            # Should not crash, should return error
            assert 'error' in str(result).lower() or result.get('success') == False


class TestCognitiveKernelMCPIntegration:
    """Test Cognitive Kernel MCP integration."""
    
    @pytest.mark.asyncio
    async def test_list_mcp_tools_via_kernel(self):
        """Test listing MCP tools via Cognitive Kernel."""
        kernel = CognitiveKernel(kendra_index_id='test-index')
        
        if kernel.mcp_registry:
            tools = await kernel.list_mcp_tools()
            
            assert isinstance(tools, dict)
            assert len(tools) > 0
            
            # Check expected servers
            expected_servers = ['semgrep-mcp', 'gitleaks-mcp', 'trivy-mcp']
            for server in expected_servers:
                assert server in tools or server.replace('-mcp', '') in tools
    
    @pytest.mark.asyncio
    async def test_invoke_mcp_tool_via_kernel(self):
        """Test invoking MCP tool via Cognitive Kernel."""
        kernel = CognitiveKernel(kendra_index_id='test-index')
        
        if kernel.mcp_registry:
            # Try to invoke a tool (will fail without proper setup, but tests the interface)
            try:
                result = await kernel.invoke_mcp_tool(
                    server_name='semgrep-mcp',
                    tool_name='semgrep_scan',
                    arguments={'source_path': '/tmp/nonexistent'}
                )
                
                # Should get a result (success or failure)
                assert 'success' in result
                assert 'server' in result
                assert 'tool' in result
                
            finally:
                await kernel.cleanup_mcp_connections()
    
    @pytest.mark.asyncio
    async def test_parallel_mcp_invocation(self):
        """Test parallel MCP tool invocation."""
        kernel = CognitiveKernel(kendra_index_id='test-index')
        
        if kernel.mcp_registry:
            invocations = [
                {
                    'server_name': 'semgrep-mcp',
                    'tool_name': 'semgrep_scan',
                    'arguments': {'source_path': '/tmp/test1'}
                },
                {
                    'server_name': 'gitleaks-mcp',
                    'tool_name': 'gitleaks_scan',
                    'arguments': {'source_path': '/tmp/test2'}
                }
            ]
            
            try:
                results = await kernel.invoke_mcp_tools_parallel(
                    invocations,
                    max_concurrency=2
                )
                
                assert len(results) == 2
                for result in results:
                    assert 'success' in result
                    assert 'server' in result
                    
            finally:
                await kernel.cleanup_mcp_connections()


class TestMCPEvidenceChain:
    """Test MCP evidence chain verification."""
    
    def test_evidence_digest_format(self):
        """Test evidence digest format compliance."""
        import hashlib
        
        # Test data
        test_data = json.dumps({"test": "data"}, sort_keys=True)
        
        # Compute digest
        digest = hashlib.sha256(test_data.encode()).hexdigest()
        formatted_digest = f"sha256:{digest}"
        
        # Verify format
        assert formatted_digest.startswith("sha256:")
        assert len(digest) == 64  # SHA256 hex length
    
    def test_evidence_chain_verification(self):
        """Test evidence chain verification logic."""
        import hashlib
        
        # Original data
        original_data = json.dumps({"findings": ["test"]}, sort_keys=True)
        original_digest = f"sha256:{hashlib.sha256(original_data.encode()).hexdigest()}"
        
        # Verify same data
        verify_digest = f"sha256:{hashlib.sha256(original_data.encode()).hexdigest()}"
        assert original_digest == verify_digest
        
        # Verify different data fails
        tampered_data = json.dumps({"findings": ["tampered"]}, sort_keys=True)
        tampered_digest = f"sha256:{hashlib.sha256(tampered_data.encode()).hexdigest()}"
        assert original_digest != tampered_digest


class TestMCPServerCompliance:
    """Test MCP server protocol compliance."""
    
    @pytest.mark.asyncio
    async def test_server_initialization(self):
        """Test MCP server initialization protocol."""
        async with MCPToolClient(
            'semgrep-mcp',
            ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            env={'MISSION_ID': 'test-init'}
        ) as client:
            # Server should initialize and be ready
            assert client.session is not None
    
    @pytest.mark.asyncio
    async def test_json_rpc_protocol(self):
        """Test JSON-RPC 2.0 protocol compliance."""
        async with MCPToolClient(
            'semgrep-mcp',
            ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            env={'MISSION_ID': 'test-jsonrpc'}
        ) as client:
            # list_tools should return proper format
            tools = await client.list_tools()
            
            # Should be a list
            assert isinstance(tools, list)
            
            # Each tool should have required fields
            for tool in tools:
                assert 'name' in tool
                assert 'description' in tool
                assert 'inputSchema' in tool
                
                # Input schema should be valid
                schema = tool['inputSchema']
                assert schema['type'] == 'object'
                assert 'properties' in schema


class TestMCPConnectionManagement:
    """Test MCP connection lifecycle management."""
    
    @pytest.mark.asyncio
    async def test_connection_cleanup(self):
        """Test proper connection cleanup."""
        client = MCPToolClient(
            'semgrep-mcp',
            ['python', 'src/mcp_servers/semgrep_mcp/server.py'],
            env={'MISSION_ID': 'test-cleanup'}
        )
        
        # Connect
        await client.connect()
        assert client.session is not None
        
        # Disconnect
        await client.disconnect()
        assert client.session is None
    
    @pytest.mark.asyncio
    async def test_registry_cleanup(self):
        """Test registry cleanup cleans all connections."""
        registry = MCPToolRegistry(base_env={'MISSION_ID': 'test-reg-cleanup'})
        
        # Get multiple clients
        await registry.get_client('semgrep-mcp')
        await registry.get_client('gitleaks-mcp')
        
        assert len(registry.clients) >= 2
        
        # Cleanup
        await registry.disconnect_all()
        
        # All clients should be cleaned
        for client in registry.clients.values():
            assert client.session is None


@pytest.fixture
def test_code_directory(tmp_path):
    """Create a temporary test code directory."""
    test_dir = tmp_path / "test-code"
    test_dir.mkdir()
    
    # Create a simple test file
    test_file = test_dir / "test.py"
    test_file.write_text("""
# Test file for MCP scanning
def unsafe_function():
    password = "hardcoded"  # Should be detected
    return password
""")
    
    return test_dir


@pytest.mark.integration
class TestEndToEndMCPWorkflow:
    """Test complete end-to-end MCP workflow."""
    
    @pytest.mark.asyncio
    async def test_full_scan_workflow(self, test_code_directory):
        """Test full scan workflow with MCP tools."""
        kernel = CognitiveKernel(kendra_index_id='test-index')
        
        if not kernel.mcp_registry:
            pytest.skip("MCP tools not enabled")
        
        try:
            # Step 1: List available tools
            tools = await kernel.list_mcp_tools()
            assert len(tools) > 0
            
            # Step 2: Create scan plan
            invocations = [
                {
                    'server_name': 'semgrep-mcp',
                    'tool_name': 'semgrep_scan',
                    'arguments': {
                        'source_path': str(test_code_directory),
                        'config': 'auto',
                        'timeout': 60
                    }
                }
            ]
            
            # Step 3: Execute scans
            results = await kernel.invoke_mcp_tools_parallel(invocations, max_concurrency=1)
            
            # Step 4: Verify results
            assert len(results) == 1
            result = results[0]
            
            assert 'success' in result
            assert result['server'] == 'semgrep-mcp'
            
            # Step 5: Verify evidence chain if successful
            if result.get('success'):
                content = result.get('content', [])
                if content:
                    assert 'storage' in str(content) or 'digest' in str(content)
            
        finally:
            await kernel.cleanup_mcp_connections()


if __name__ == "__main__":
    pytest.main([__file__, '-v', '-s'])