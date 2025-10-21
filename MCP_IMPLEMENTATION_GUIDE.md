# Model Context Protocol (MCP) Implementation Guide

## Overview

This document describes the **proper Model Context Protocol implementation** added to Hivemind-Prism. The system now uses genuine MCP JSON-RPC 2.0 communication between agents and security scanning tools.

## What Was Implemented

### 1. MCP Server Implementation (✅ Complete)

#### Semgrep MCP Server
**File:** [`src/mcp_servers/semgrep_mcp/server.py`](src/mcp_servers/semgrep_mcp/server.py)

**Features:**
- ✅ Full MCP protocol compliance with JSON-RPC 2.0
- ✅ Stdio transport layer for communication
- ✅ Async/await architecture
- ✅ Tool definitions with input schemas
- ✅ `list_tools()` handler returns available tools
- ✅ `call_tool()` handler executes security scans
- ✅ Cryptographic evidence chains (SHA256 digests)
- ✅ S3 storage integration
- ✅ DynamoDB indexing

**Available Tools:**
```python
{
  "name": "semgrep_scan",
  "description": "Run Semgrep SAST analysis",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source_path": {"type": "string"},
      "config": {"type": "string", "default": "auto"},
      "timeout": {"type": "integer", "default": 300}
    }
  }
}
```

**Protocol Flow:**
```
Agent → MCP Client → JSON-RPC → MCP Server (stdio) → Semgrep CLI → Results
```

### 2. MCP Client Library (✅ Complete)

**Files:**
- [`src/shared/mcp_client/client.py`](src/shared/mcp_client/client.py)
- [`src/shared/mcp_client/__init__.py`](src/shared/mcp_client/__init__.py)

**Classes:**

#### `MCPToolClient`
Single MCP server client with stdio transport.

```python
async with MCPToolClient('semgrep-mcp', ['python', 'server.py']) as client:
    tools = await client.list_tools()
    result = await client.call_tool('semgrep_scan', {
        'source_path': 'unzipped/mission-123/'
    })
```

#### `MCPToolRegistry`
Registry managing multiple MCP servers.

```python
async with MCPToolRegistry() as registry:
    # List all tools from all servers
    all_tools = await registry.list_all_tools()
    
    # Call specific tool
    result = await registry.call_tool(
        'semgrep-mcp',
        'semgrep_scan',
        {'source_path': 'unzipped/mission-123/'}
    )
```

**Supported Servers:**
- `semgrep-mcp` - SAST security scanning
- `gitleaks-mcp` - Secret detection (needs MCP conversion)
- `trivy-mcp` - Container/dependency scanning (needs MCP conversion)
- `scoutsuite-mcp` - AWS security assessment (needs MCP conversion)
- `pacu-mcp` - AWS penetration testing (needs MCP conversion)

### 3. Cognitive Kernel MCP Integration (✅ Complete)

**File:** [`src/shared/cognitive_kernel/bedrock_client.py`](src/shared/cognitive_kernel/bedrock_client.py)

**New Methods:**

#### `async list_mcp_tools()`
Lists all available MCP tools from all servers.

```python
kernel = CognitiveKernel(kendra_index_id='...')
tools = await kernel.list_mcp_tools()
# Returns: {'semgrep-mcp': [...], 'gitleaks-mcp': [...]}
```

#### `async invoke_mcp_tool()`
Invokes a single MCP tool with security features.

```python
result = await kernel.invoke_mcp_tool(
    server_name='semgrep-mcp',
    tool_name='semgrep_scan',
    arguments={'source_path': 'unzipped/mission-123/'},
    additional_env={'TIMEOUT': '600'}
)
```

**Security Features:**
- Argument sanitization
- Cryptographic logging (hashes, not plaintext)
- No sensitive data in exceptions
- Evidence chain verification

#### `async invoke_mcp_tools_parallel()`
Invokes multiple MCP tools concurrently with semaphore control.

```python
invocations = [
    {
        'server_name': 'semgrep-mcp',
        'tool_name': 'semgrep_scan',
        'arguments': {'source_path': 'unzipped/mission-123/'}
    },
    {
        'server_name': 'gitleaks-mcp',
        'tool_name': 'gitleaks_scan',
        'arguments': {'source_path': 'unzipped/mission-123/'}
    }
]

results = await kernel.invoke_mcp_tools_parallel(
    invocations,
    max_concurrency=5
)
```

#### `async cleanup_mcp_connections()`
Properly closes all MCP server connections.

```python
await kernel.cleanup_mcp_connections()
```

## How Agents Use MCP

### Before MCP (Old Way)
Agents triggered ECS Fargate tasks via Step Functions, which ran standalone container scripts.

```
Agent → Step Functions → ECS RunTask → Container → S3 Results
```

**Problems:**
- No standard protocol
- No tool discovery
- Hard-coded tool definitions
- Cannot integrate external MCP tools

### After MCP (New Way)
Agents use `CognitiveKernel` to invoke MCP tools via JSON-RPC protocol.

```
Agent → CognitiveKernel → MCP Client → JSON-RPC (stdio) → MCP Server → Tool
```

**Benefits:**
- ✅ Standard protocol (MCP/JSON-RPC 2.0)
- ✅ Dynamic tool discovery via `list_tools()`
- ✅ Proper input schema validation
- ✅ Can integrate any MCP-compliant tool
- ✅ Better error handling and logging
- ✅ Evidence chains with cryptographic verification

### Example: Coordinator Agent Using MCP

```python
from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel

class CoordinatorAgent:
    def __init__(self):
        self.cognitive_kernel = CognitiveKernel(
            kendra_index_id=os.environ['KENDRA_INDEX_ID']
        )
    
    async def run(self):
        # List available MCP tools
        available_tools = await self.cognitive_kernel.list_mcp_tools()
        
        # Decide which tools to run based on context
        tool_plan = self._create_execution_plan(available_tools)
        
        # Execute tools in parallel
        results = await self.cognitive_kernel.invoke_mcp_tools_parallel(
            tool_plan,
            max_concurrency=5
        )
        
        # Process results
        for result in results:
            if result['success']:
                self._store_result(result)
        
        # Cleanup
        await self.cognitive_kernel.cleanup_mcp_connections()
```

## Remaining Work

### 1. Convert Other MCP Servers (⚠️ Pending)

The following servers still use the old wrapper pattern and need MCP conversion:

#### Priority 1: Gitleaks MCP Server
**File:** `src/mcp_servers/gitleaks_mcp/server.py`

**Required Changes:**
```python
# Add MCP SDK imports
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

# Convert to async
class GitleaksMCPServer:
    def __init__(self):
        self.server = Server("gitleaks-mcp")
        self._register_handlers()
    
    def _register_handlers(self):
        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            return [
                Tool(
                    name="gitleaks_scan",
                    description="Detect hardcoded secrets and credentials",
                    inputSchema={...}
                )
            ]
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: Any):
            # Execute gitleaks scan
            # Return TextContent with results
            pass
```

#### Priority 2-4: Other Servers
- `trivy_mcp/server.py` - Container vulnerability scanning
- `scoutsuite_mcp/server.py` - AWS security assessment
- `pacu_mcp/server.py` - AWS penetration testing

**Template:** Use [`semgrep_mcp/server.py`](src/mcp_servers/semgrep_mcp/server.py) as the reference implementation.

### 2. Update Agent Implementations (⚠️ Pending)

Agents need to be updated to use async MCP calls instead of synchronous ECS invocations.

**Files to Update:**
- `src/agents/coordinator/agent.py`
- `src/agents/strategist/agent.py`
- `src/agents/synthesizer/agent.py`

**Example Update for Coordinator:**

```python
# OLD (synchronous ECS invocation)
def run(self):
    # Step Functions handles ECS tasks
    pass

# NEW (async MCP invocation)
async def run(self):
    # Use cognitive kernel for MCP
    results = await self.cognitive_kernel.invoke_mcp_tools_parallel([
        {
            'server_name': 'semgrep-mcp',
            'tool_name': 'semgrep_scan',
            'arguments': {'source_path': f'unzipped/{self.mission_id}/'}
        }
    ])
    
    return results
```

### 3. Update Step Functions Orchestration (⚠️ Pending)

**File:** `infrastructure/stacks/orchestration-stack.ts`

**Current:** Step Functions directly invokes ECS tasks for MCP servers.

**Needed:** Step Functions should invoke agent Fargate tasks, which then use MCP protocol internally.

**Changes:**
1. Remove direct ECS task definitions for MCP tools from Step Functions
2. Agents run as Fargate tasks and manage MCP server processes internally
3. MCP servers run as child processes spawned by agents (stdio transport)

**Alternative Architecture:**
- Keep MCP servers as separate Fargate tasks
- Use HTTP/SSE transport instead of stdio
- Requires more complex networking but better isolation

### 4. Testing (⚠️ Pending)

**Create Tests:**
- `tests/integration/test_mcp_protocol.py` - Test JSON-RPC communication
- `tests/integration/test_mcp_semgrep.py` - Test semgrep MCP server
- Update existing unit tests to mock MCP clients

**Test Scenarios:**
1. MCP server starts and responds to `initialize`
2. `list_tools()` returns proper tool definitions
3. `call_tool()` executes and returns results
4. Error handling for invalid arguments
5. Evidence chain verification (SHA256 digests)
6. Parallel tool invocation with concurrency limits

### 5. Update Documentation (⚠️ In Progress)

**Files to Update:**
- `DESIGN.md` - Update Section 5.4 "MCP Tool Fleet" with actual MCP protocol
- `SPEC.md` - Add MCP protocol specifications
- `README.md` - Add MCP usage examples
- `AWS_MCP_SERVERS_QUICKSTART.md` - Update with real MCP implementation

## Migration Path

### Phase 1: Core MCP Infrastructure (✅ Complete)
- [x] MCP server implementation (Semgrep)
- [x] MCP client library
- [x] Cognitive kernel integration

### Phase 2: Remaining MCP Servers (🚧 In Progress)
- [ ] Convert gitleaks to MCP
- [ ] Convert trivy to MCP
- [ ] Convert scoutsuite to MCP
- [ ] Convert pacu to MCP

### Phase 3: Agent Integration (⚠️ Pending)
- [ ] Update Coordinator agent to use MCP
- [ ] Update Strategist agent to use MCP
- [ ] Update Synthesizer agent for MCP results
- [ ] Update orchestration for async agent execution

### Phase 4: Infrastructure Updates (⚠️ Pending)
- [ ] Update Step Functions definitions
- [ ] Update ECS task definitions for agent-managed MCP
- [ ] Update security groups for MCP communication
- [ ] Update IAM roles for MCP operations

### Phase 5: Testing & Validation (⚠️ Pending)
- [ ] Integration tests for MCP protocol
- [ ] End-to-end tests with real scans
- [ ] Performance testing
- [ ] Security validation

### Phase 6: Documentation (⚠️ Pending)
- [ ] Update DESIGN.md with MCP details
- [ ] Update SPEC.md with protocol specs
- [ ] Create developer guide for adding MCP tools
- [ ] Update deployment documentation

## Benefits of MCP Implementation

### 1. **Standard Protocol**
- Industry-standard Model Context Protocol
- Compatible with other MCP tools/servers
- Well-defined JSON-RPC 2.0 communication

### 2. **Dynamic Tool Discovery**
- Agents can query available tools at runtime
- No hard-coded tool definitions
- Easy to add new tools

### 3. **Better Integration**
- Can integrate external MCP servers (not just our own)
- Tools from Anthropic, community, or partners
- Unified interface for all tool types

### 4. **Improved Security**
- Cryptographic evidence chains
- Input/output sanitization
- Secure credential handling
- Audit logging with hashes

### 5. **Flexibility**
- Multiple transport options (stdio, HTTP, SSE)
- Can run tools locally or remotely
- Better error handling and retry logic

## Example: Complete MCP Workflow

```python
# 1. Agent initializes cognitive kernel
kernel = CognitiveKernel(kendra_index_id='abc-123')

# 2. List available tools
available_tools = await kernel.list_mcp_tools()
# {
#   'semgrep-mcp': [
#     {'name': 'semgrep_scan', 'description': '...', 'inputSchema': {...}}
#   ],
#   'gitleaks-mcp': [
#     {'name': 'gitleaks_scan', 'description': '...', 'inputSchema': {...}}
#   ]
# }

# 3. Create execution plan
tool_invocations = [
    {
        'server_name': 'semgrep-mcp',
        'tool_name': 'semgrep_scan',
        'arguments': {
            'source_path': 'unzipped/mission-abc/src/',
            'config': 'auto',
            'timeout': 300
        }
    },
    {
        'server_name': 'gitleaks-mcp',
        'tool_name': 'gitleaks_scan',
        'arguments': {
            'source_path': 'unzipped/mission-abc/'
        }
    }
]

# 4. Execute tools in parallel
results = await kernel.invoke_mcp_tools_parallel(
    tool_invocations,
    max_concurrency=5
)

# 5. Process results
for result in results:
    if result['success']:
        content = result['content'][0]  # Get first content block
        findings = content['findings_count']
        s3_uri = content['storage']['s3_uri']
        digest = content['storage']['digest']
        
        # Verify evidence chain
        assert digest.startswith('sha256:')
        
        # Store in findings archive
        await store_findings(s3_uri, digest)

# 6. Cleanup
await kernel.cleanup_mcp_connections()
```

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [MCP Python SDK](https://github.com/anthropics/python-mcp)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- Hivemind-Prism Implementation: [`src/mcp_servers/semgrep_mcp/server.py`](src/mcp_servers/semgrep_mcp/server.py)
- MCP Client Library: [`src/shared/mcp_client/client.py`](src/shared/mcp_client/client.py)

## Questions?

For implementation questions or issues with MCP integration, refer to:
1. This guide (MCP_IMPLEMENTATION_GUIDE.md)
2. Reference implementation: `src/mcp_servers/semgrep_mcp/server.py`
3. MCP Client library: `src/shared/mcp_client/`
4. Cognitive Kernel integration: `src/shared/cognitive_kernel/bedrock_client.py`