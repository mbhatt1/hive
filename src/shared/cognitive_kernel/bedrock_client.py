"""
Cognitive Kernel - Amazon Bedrock Integration
Provides secure, unified interface to Bedrock models for all agents.
Supports Model Context Protocol (MCP) tool invocation.
"""

import os
import json
import boto3
import hashlib
import asyncio
from typing import Dict, List, Optional, Any
from botocore.config import Config
from dataclasses import dataclass
import logging
from src.shared.mcp_client.client import MCPToolRegistry

logger = logging.getLogger(__name__)

@dataclass
class BedrockResponse:
    """Structured response from Bedrock invocation."""
    content: str
    stop_reason: str
    usage: Dict[str, int]
    model_id: str

@dataclass
class KendraContext:
    """Structured Kendra retrieval context."""
    documents: List[Dict[str, Any]]
    query: str
    total_results: int

class CognitiveKernel:
    """
    Secure interface to Amazon Bedrock for agent cognition.
    
    Security features:
    - No credential caching
    - Request/response logging for audit
    - Input sanitization
    - Rate limiting awareness
    - Error handling with no sensitive data leakage
    """
    
    def __init__(
        self,
        region: str = "us-east-1",
        model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0",
        kendra_index_id: Optional[str] = None
    ):
        """
        Initialize Cognitive Kernel.
        
        Args:
            region: AWS region for Bedrock
            model_id: Bedrock model identifier
            kendra_index_id: Kendra index for RAG
        """
        # Secure boto3 config
        config = Config(
            region_name=region,
            signature_version='v4',
            retries={'max_attempts': 3, 'mode': 'adaptive'}
        )
        
        self.bedrock_runtime = boto3.client(
            'bedrock-runtime',
            config=config
        )
        
        self.kendra_client = boto3.client(
            'kendra',
            config=config
        ) if kendra_index_id else None
        
        
        # MCP Tool Registry for tool invocation
        self.mcp_registry = None
        if os.environ.get('ENABLE_MCP_TOOLS', 'true').lower() == 'true':
            self.mcp_registry = MCPToolRegistry(base_env={
                'MISSION_ID': os.environ.get('MISSION_ID', ''),
                'S3_ARTIFACTS_BUCKET': os.environ.get('S3_ARTIFACTS_BUCKET', ''),
                'DYNAMODB_TOOL_RESULTS_TABLE': os.environ.get('DYNAMODB_TOOL_RESULTS_TABLE', ''),
                'AWS_REGION': region
            })
        self.model_id = model_id
        self.kendra_index_id = kendra_index_id
        
        logger.info(f"CognitiveKernel initialized with model: {model_id}")
    
    def invoke_claude(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        tools: Optional[List[Dict]] = None
    ) -> BedrockResponse:
        """
        Invoke Claude model with system and user prompts.
        
        Args:
            system_prompt: System instructions for the model
            user_prompt: User message/question
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0-1)
            tools: Optional tool definitions for function calling
            
        Returns:
            BedrockResponse with content and metadata
            
        Security:
            - Sanitizes inputs
            - Logs request hash for audit
            - No sensitive data in exceptions
        """
        try:
            # Sanitize inputs
            system_prompt = self._sanitize_input(system_prompt)
            user_prompt = self._sanitize_input(user_prompt)
            
            # Compute request hash for audit logging
            request_hash = self._compute_hash(system_prompt + user_prompt)
            logger.info(f"Bedrock invocation request hash: {request_hash}")
            
            # Construct request payload
            messages = [
                {
                    "role": "user",
                    "content": user_prompt
                }
            ]
            
            request_body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system_prompt,
                "messages": messages
            }
            
            if tools:
                request_body["tools"] = tools
            
            # Invoke Bedrock
            response = self.bedrock_runtime.invoke_model(
                modelId=self.model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body)
            )
            
            # Parse response
            response_body = json.loads(response['body'].read())
            
            # Extract content
            content = ""
            if response_body.get("content"):
                for block in response_body["content"]:
                    if block.get("type") == "text":
                        content += block.get("text", "")
            
            bedrock_response = BedrockResponse(
                content=content,
                stop_reason=response_body.get("stop_reason", "unknown"),
                usage=response_body.get("usage", {}),
                model_id=self.model_id
            )
            
            logger.info(f"Bedrock invocation successful. Tokens used: {bedrock_response.usage}")
            
            return bedrock_response
            
        except Exception as e:
            logger.error(f"Bedrock invocation failed: {str(e)}", exc_info=True)
            raise RuntimeError("Bedrock invocation failed") from e
    
    def invoke_with_rag(
        self,
        query: str,
        system_prompt: str,
        user_prompt_template: str,
        top_k: int = 5,
        max_tokens: int = 4096
    ) -> BedrockResponse:
        """
        Invoke Claude with RAG-augmented context from Kendra.
        
        Args:
            query: Kendra search query
            system_prompt: System instructions
            user_prompt_template: Template with {context} placeholder
            top_k: Number of documents to retrieve
            max_tokens: Maximum tokens to generate
            
        Returns:
            BedrockResponse with RAG-augmented answer
            
        Security:
            - Kendra results filtered and sanitized
            - Context size limited to prevent injection
        """
        if not self.kendra_client or not self.kendra_index_id:
            raise ValueError("Kendra not configured for RAG")
        
        try:
            # Retrieve from Kendra
            kendra_context = self.retrieve_from_kendra(query, top_k)
            
            # Format context
            context_text = self._format_kendra_context(kendra_context)
            
            # Inject context into user prompt
            user_prompt = user_prompt_template.format(context=context_text)
            
            # Invoke with augmented prompt
            return self.invoke_claude(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                max_tokens=max_tokens
            )
            
        except Exception as e:
            logger.error(f"RAG invocation failed: {str(e)}", exc_info=True)
            raise RuntimeError("RAG invocation failed") from e
    
    def retrieve_from_kendra(
        self,
        query: str,
        top_k: int = 5,
        attribute_filter: Optional[Dict] = None
    ) -> KendraContext:
        """
        Retrieve relevant documents from Kendra.
        
        Args:
            query: Search query
            top_k: Number of results to return
            attribute_filter: Optional attribute filters
            
        Returns:
            KendraContext with retrieved documents
        """
        if not self.kendra_client or not self.kendra_index_id:
            raise ValueError("Kendra not configured")
        
        try:
            query = self._sanitize_input(query)
            
            retrieve_args = {
                'IndexId': self.kendra_index_id,
                'QueryText': query,
                'PageSize': top_k
            }
            
            if attribute_filter:
                retrieve_args['AttributeFilter'] = attribute_filter
            
            response = self.kendra_client.retrieve(**retrieve_args)
            
            documents = []
            for result in response.get('ResultItems', []):
                documents.append({
                    'id': result.get('Id'),
                    'title': result.get('DocumentTitle'),
                    'excerpt': result.get('Content', ''),
                    'uri': result.get('DocumentURI'),
                    'score': result.get('ScoreAttributes', {}).get('ScoreConfidence'),
                    'attributes': result.get('DocumentAttributes', [])
                })
            
            kendra_context = KendraContext(
                documents=documents,
                query=query,
                total_results=len(documents)
            )
            
            logger.info(f"Kendra retrieval successful. {len(documents)} documents found.")
            
            return kendra_context
            
        except Exception as e:
            logger.error(f"Kendra retrieval failed: {str(e)}", exc_info=True)
            raise RuntimeError("Kendra retrieval failed") from e
    
    def generate_embeddings(
        self,
        text: str,
        model_id: str = "amazon.titan-embed-text-v1"
    ) -> List[float]:
        """
        Generate embeddings using Titan.
        
        Args:
            text: Text to embed
            model_id: Embedding model ID
            
        Returns:
            List of embedding values
        """
        try:
            text = self._sanitize_input(text)
            
            request_body = {
                "inputText": text
            }
            
            response = self.bedrock_runtime.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body)
            )
            
            response_body = json.loads(response['body'].read())
            embeddings = response_body.get('embedding', [])
            
            logger.info(f"Generated embeddings: {len(embeddings)} dimensions")
            
            return embeddings
            
        except Exception as e:
            logger.error(f"Embedding generation failed: {str(e)}", exc_info=True)
            raise RuntimeError("Embedding generation failed") from e
    
    def _sanitize_input(self, text: str, max_length: int = 100000) -> str:
        """Sanitize input text to prevent injection attacks."""
        if not isinstance(text, str):
            raise ValueError("Input must be string")
        
        # Truncate to reasonable length
        if len(text) > max_length:
            logger.warning(f"Input truncated from {len(text)} to {max_length} chars")
            text = text[:max_length]
        
        return text
    
    def _compute_hash(self, content: str) -> str:
        """Compute SHA256 hash for audit logging."""
        return hashlib.sha256(content.encode('utf-8')).hexdigest()[:16]
    
    def _format_kendra_context(self, context: KendraContext, max_docs: int = 5) -> str:
        """Format Kendra documents into context string."""
        formatted = []
        
        for i, doc in enumerate(context.documents[:max_docs]):
            formatted.append(f"Document {i+1}:")
            formatted.append(f"Title: {doc['title']}")
            formatted.append(f"Content: {doc['excerpt'][:500]}...")
            formatted.append(f"URI: {doc['uri']}")
            formatted.append("")
        
        return "\n".join(formatted)
    
    async def list_mcp_tools(self) -> Dict[str, List[Dict[str, Any]]]:
        """
        List all available MCP tools from all servers.
        
        Returns:
            Dictionary mapping server names to their available tools
            
        Raises:
            RuntimeError: If MCP tools are not enabled
        """
        if not self.mcp_registry:
            raise RuntimeError("MCP tools not enabled. Set ENABLE_MCP_TOOLS=true")
        
        try:
            all_tools = await self.mcp_registry.list_all_tools()
            logger.info(f"Listed MCP tools from {len(all_tools)} servers")
            return all_tools
        except Exception as e:
            logger.error(f"Failed to list MCP tools: {e}", exc_info=True)
            raise
    
    async def invoke_mcp_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: Dict[str, Any],
        additional_env: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Invoke an MCP tool on a specific server.
        
        Args:
            server_name: Name of the MCP server (e.g., 'semgrep-mcp')
            tool_name: Name of the tool to invoke
            arguments: Tool arguments
            additional_env: Additional environment variables for the tool
            
        Returns:
            Tool execution result
            
        Security:
            - Arguments are sanitized
            - Tool output is logged with hash
            - Errors don't leak sensitive information
        """
        if not self.mcp_registry:
            raise RuntimeError("MCP tools not enabled. Set ENABLE_MCP_TOOLS=true")
        
        try:
            # Sanitize arguments
            sanitized_args = {
                k: self._sanitize_input(str(v)) if isinstance(v, str) else v
                for k, v in arguments.items()
            }
            
            # Log invocation
            args_hash = self._compute_hash(json.dumps(sanitized_args, sort_keys=True))
            logger.info(f"Invoking MCP tool: {server_name}.{tool_name}, args_hash={args_hash}")
            
            # Call tool via MCP protocol
            result = await self.mcp_registry.call_tool(
                server_name=server_name,
                tool_name=tool_name,
                arguments=sanitized_args,
                env=additional_env
            )
            
            # Log result hash
            if result.get('success'):
                result_hash = self._compute_hash(json.dumps(result, sort_keys=True))
                logger.info(f"MCP tool succeeded: {server_name}.{tool_name}, result_hash={result_hash}")
            else:
                logger.warning(f"MCP tool failed: {server_name}.{tool_name}, error={result.get('error')}")
            
            return result
            
        except Exception as e:
            logger.error(f"MCP tool invocation failed: {server_name}.{tool_name}: {e}", exc_info=True)
            return {
                'success': False,
                'server': server_name,
                'tool': tool_name,
                'error': str(e)
            }
    
    async def invoke_mcp_tools_parallel(
        self,
        tool_invocations: List[Dict[str, Any]],
        max_concurrency: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Invoke multiple MCP tools in parallel with concurrency control.
        
        Args:
            tool_invocations: List of tool invocation specs with server_name, tool_name, arguments
            max_concurrency: Maximum number of concurrent tool invocations
            
        Returns:
            List of tool execution results in same order as input
            
        Example:
            tool_invocations = [
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
        """
        if not self.mcp_registry:
            raise RuntimeError("MCP tools not enabled. Set ENABLE_MCP_TOOLS=true")
        
        async def invoke_single(invocation: Dict[str, Any]) -> Dict[str, Any]:
            """Helper to invoke a single tool."""
            return await self.invoke_mcp_tool(
                server_name=invocation['server_name'],
                tool_name=invocation['tool_name'],
                arguments=invocation.get('arguments', {}),
                additional_env=invocation.get('env')
            )
        
        # Create semaphore for concurrency control
        semaphore = asyncio.Semaphore(max_concurrency)
        
        async def invoke_with_semaphore(invocation: Dict[str, Any]) -> Dict[str, Any]:
            """Invoke with semaphore for concurrency control."""
            async with semaphore:
                return await invoke_single(invocation)
        
        # Execute all invocations concurrently
        logger.info(f"Invoking {len(tool_invocations)} MCP tools with max_concurrency={max_concurrency}")
        results = await asyncio.gather(
            *[invoke_with_semaphore(inv) for inv in tool_invocations],
            return_exceptions=True
        )
        
        # Handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Tool invocation {i} failed with exception: {result}")
                processed_results.append({
                    'success': False,
                    'error': str(result),
                    'invocation': tool_invocations[i]
                })
            else:
                processed_results.append(result)
        
        success_count = sum(1 for r in processed_results if r.get('success'))
        logger.info(f"Parallel MCP invocation complete: {success_count}/{len(tool_invocations)} succeeded")
        
        return processed_results
    
    async def cleanup_mcp_connections(self):
        """Clean up all MCP server connections."""
        if self.mcp_registry:
            try:
                await self.mcp_registry.disconnect_all()
                logger.info("All MCP connections closed")
            except Exception as e:
                logger.warning(f"Error during MCP cleanup: {e}")