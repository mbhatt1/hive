"""
Code Research Module
====================

Provides deep code analysis capabilities for security research.

Classes:
    DeepCodeResearcher: Comprehensive code analysis and research
    FileMetadata: File metadata dataclass
    DependencyNode: Dependency graph node
    CallGraphNode: Call graph node
    DataFlow: Data flow analysis
    CodePattern: Security pattern detection
"""

from .deep_researcher import (
    DeepCodeResearcher,
    FileMetadata,
    DependencyNode,
    CallGraphNode,
    DataFlow,
    CodePattern,
)

__all__ = [
    "DeepCodeResearcher",
    "FileMetadata",
    "DependencyNode",
    "CallGraphNode",
    "DataFlow",
    "CodePattern",
]