"""
Unit Tests for Deep Code Researcher
====================================

Tests the comprehensive code analysis engine.
"""

import pytest
import tempfile
import os
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from src.shared.code_research.deep_researcher import (
    DeepCodeResearcher,
    FileMetadata,
    DependencyNode,
    CallGraphNode,
    CodePattern
)


@pytest.mark.shared
@pytest.mark.unit
class TestDeepCodeResearcher:
    """Test suite for DeepCodeResearcher."""
    
    def test_initialization(self):
        """Test DeepCodeResearcher initialization."""
        with tempfile.TemporaryDirectory() as tmpdir:
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            assert researcher.workspace_dir == Path(tmpdir)
            assert researcher.kendra_index_id == 'test-index'
            assert researcher.s3_bucket == 'test-bucket'
            assert researcher.max_file_size == 5 * 1024 * 1024
    
    def test_catalog_repository_empty(self):
        """Test cataloging empty repository."""
        with tempfile.TemporaryDirectory() as tmpdir:
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            stats = researcher.catalog_repository()
            
            assert stats['total_files'] == 0
            assert stats['total_lines'] == 0
    
    def test_catalog_repository_with_python_files(self):
        """Test cataloging repository with Python files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create test Python file
            test_file = Path(tmpdir) / 'test.py'
            test_file.write_text("""
import os
import sys

def hello():
    return "world"

class TestClass:
    pass
""")
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            stats = researcher.catalog_repository()
            
            assert stats['total_files'] == 1
            assert stats['total_lines'] > 0
            assert stats['languages']['python'] == 1
            assert stats['file_types']['.py'] == 1
    
    def test_analyze_python_file(self):
        """Test Python file analysis."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / 'sample.py'
            test_file.write_text("""
import json
from typing import Dict

class Calculator:
    def add(self, a, b):
        return a + b
    
    def subtract(self, a, b):
        return a - b

def main():
    calc = Calculator()
    result = calc.add(1, 2)
    return result
""")
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            metadata = researcher._analyze_file(test_file)
            
            assert metadata is not None
            assert metadata.language == 'python'
            assert 'json' in metadata.imports
            assert 'typing' in metadata.imports
            assert 'add' in metadata.functions
            assert 'subtract' in metadata.functions
            assert 'main' in metadata.functions
            assert 'Calculator' in metadata.classes
            assert metadata.line_count > 0
            assert len(metadata.hash_sha256) == 64
    
    def test_build_dependency_graph(self):
        """Test dependency graph construction."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create files
            file1 = Path(tmpdir) / 'module1.py'
            file1.write_text("""
def func1():
    pass
""")
            
            file2 = Path(tmpdir) / 'module2.py'
            file2.write_text("""
from module1 import func1

def func2():
    func1()
""")
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            researcher.catalog_repository()
            dep_graph = researcher.build_dependency_graph()
            
            assert len(dep_graph) == 2
            assert any('module1' in k for k in dep_graph.keys())
            assert any('module2' in k for k in dep_graph.keys())
    
    def test_build_call_graph(self):
        """Test call graph construction."""
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = Path(tmpdir) / 'calls.py'
            test_file.write_text("""
def helper():
    return 42

def main():
    result = helper()
    return result
""")
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            researcher.catalog_repository()
            call_graph = researcher.build_call_graph()
            
            assert len(call_graph) > 0
            # Verify at least one function is tracked
            assert any('main' in k or 'helper' in k for k in call_graph.keys())
    
    def test_detects_security_patterns(self):
        """Test security pattern detection."""
        with tempfile.TemporaryDirectory() as tmpdir:
            vuln_file = Path(tmpdir) / 'vulnerable.py'
            vuln_file.write_text("""
import os

password = "hardcoded123"
api_key = "sk-abc123"

def execute_command(user_input):
    os.system(user_input)  # Command injection

def query_db(user_id):
    query = "SELECT * FROM users WHERE id = " + user_id  # SQL injection
    return query
""")
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            researcher.catalog_repository()
            
            # The security patterns should be detectable
            assert len(researcher.security_patterns) > 0
            assert 'hardcoded_secret' in researcher.security_patterns
            assert 'command_injection' in researcher.security_patterns
            assert 'sql_injection' in researcher.security_patterns
    
    def test_skips_hidden_directories(self):
        """Test that hidden directories are skipped."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create hidden directory
            hidden_dir = Path(tmpdir) / '.git'
            hidden_dir.mkdir()
            (hidden_dir / 'config').write_text('git config')
            
            # Create normal file
            (Path(tmpdir) / 'app.py').write_text('print("hello")')
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            stats = researcher.catalog_repository()
            
            # Should only find app.py, not .git/config
            assert stats['total_files'] == 1
    
    def test_skips_vendor_directories(self):
        """Test that vendor directories are skipped."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create node_modules
            node_modules = Path(tmpdir) / 'node_modules'
            node_modules.mkdir()
            (node_modules / 'lib.js').write_text('module.exports = {}')
            
            # Create normal file
            (Path(tmpdir) / 'index.js').write_text('const x = 1')
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            stats = researcher.catalog_repository()
            
            # Should only find index.js, not node_modules/lib.js
            assert stats['total_files'] == 1
    
    def test_respects_max_file_size(self):
        """Test that files over max size are skipped."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a large file
            large_file = Path(tmpdir) / 'large.py'
            large_file.write_text('x = 1\n' * 1000000)  # Very large file
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket',
                max_file_size_mb=1  # 1 MB limit
            )
            
            metadata = researcher._analyze_file(large_file)
            
            # Should return None for files over limit
            assert metadata is None
    
    def test_handles_non_utf8_files(self):
        """Test handling of non-UTF8 files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            binary_file = Path(tmpdir) / 'binary.py'
            binary_file.write_bytes(b'\x80\x81\x82\x83')
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            metadata = researcher._analyze_file(binary_file)
            
            # Should handle gracefully (either return None or handle with errors='ignore')
            assert metadata is None or isinstance(metadata, FileMetadata)
    
    def test_calculate_complexity(self):
        """Test cyclomatic complexity calculation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            complex_file = Path(tmpdir) / 'complex.py'
            complex_file.write_text("""
def complex_function(x):
    if x > 0:
        if x > 10:
            return "large"
        else:
            return "small"
    elif x < 0:
        return "negative"
    else:
        return "zero"
""")
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            metadata = researcher._analyze_file(complex_file)
            
            assert metadata is not None
            assert metadata.complexity_score > 1  # Should detect branches
    
    @patch('boto3.client')
    def test_s3_integration(self, mock_boto):
        """Test S3 client initialization."""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_s3 = Mock()
            mock_boto.return_value = mock_s3
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            assert researcher.s3 is not None
    
    @patch('boto3.client')
    def test_kendra_integration(self, mock_boto):
        """Test Kendra client initialization."""
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_kendra = Mock()
            mock_boto.return_value = mock_kendra
            
            researcher = DeepCodeResearcher(
                workspace_dir=tmpdir,
                kendra_index_id='test-index',
                s3_bucket='test-bucket'
            )
            
            assert researcher.kendra is not None


if __name__ == '__main__':
    pytest.main([__file__, '-v'])