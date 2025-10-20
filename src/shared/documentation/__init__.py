"""
Documentation Module
====================

Provides security wiki generation capabilities.

Classes:
    SecurityWikiGenerator: Generate comprehensive security documentation
    WikiPage: Wiki page dataclass
    SecurityWiki: Security wiki dataclass
"""

from .wiki_generator import SecurityWikiGenerator, WikiPage, SecurityWiki

__all__ = ["SecurityWikiGenerator", "WikiPage", "SecurityWiki"]