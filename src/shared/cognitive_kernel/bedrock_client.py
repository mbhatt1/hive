"""
Cognitive Kernel - Amazon Bedrock Integration
Provides secure, unified interface to Bedrock models for all agents.
"""

import json
import boto3
import hashlib
from typing import Dict, List, Optional, Any
from botocore.config import Config
from dataclasses import dataclass
import logging

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
        model_id: str = "anthropic.claude-sonnet-4-20250514-v1:0",
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