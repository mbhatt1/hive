"""
Cognitive Kernel Module
=======================

Provides Bedrock client with RAG capabilities for agent cognition.

Classes:
    CognitiveKernel: Secure Bedrock client with Kendra integration
    BedrockResponse: Response dataclass
    KendraContext: Kendra context dataclass
"""

from .bedrock_client import CognitiveKernel, BedrockResponse, KendraContext

__all__ = ["CognitiveKernel", "BedrockResponse", "KendraContext"]