"""
Deep Code Research Module for Hivemind-Prism Agents

This module provides comprehensive code analysis capabilities including:
- Recursive file discovery and cataloging
- AST-based code structure analysis
- Dependency graph construction
- Call graph analysis
- Data flow tracking
- Pattern matching across files
- Semantic code search with Kendra integration
- Multi-source intelligence synthesis
"""

import os
import json
import hashlib
from pathlib import Path
from typing import Dict, List, Set, Optional, Any, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
import ast
import re
import boto3
from botocore.exceptions import ClientError


@dataclass
class FileMetadata:
    """Metadata about a discovered file"""
    path: str
    relative_path: str
    extension: str
    size_bytes: int
    line_count: int
    language: str
    hash_sha256: str
    imports: List[str] = field(default_factory=list)
    functions: List[str] = field(default_factory=list)
    classes: List[str] = field(default_factory=list)
    complexity_score: int = 0


@dataclass
class DependencyNode:
    """Node in dependency graph"""
    file_path: str
    imports: Set[str] = field(default_factory=set)
    imported_by: Set[str] = field(default_factory=set)
    functions: Set[str] = field(default_factory=set)
    classes: Set[str] = field(default_factory=set)


@dataclass
class CallGraphNode:
    """Node in call graph"""
    function_name: str
    file_path: str
    line_number: int
    calls: Set[str] = field(default_factory=set)
    called_by: Set[str] = field(default_factory=set)
    parameters: List[str] = field(default_factory=list)


@dataclass
class DataFlow:
    """Data flow tracking"""
    variable_name: str
    source_file: str
    source_line: int
    flow_chain: List[Tuple[str, int]] = field(default_factory=list)
    sinks: List[Tuple[str, int]] = field(default_factory=list)


@dataclass
class CodePattern:
    """Detected code pattern"""
    pattern_type: str
    file_path: str
    line_number: int
    snippet: str
    severity: str
    description: str


class DeepCodeResearcher:
    """
    Deep code research engine that provides comprehensive analysis
    of uploaded source code repositories
    """
    
    def __init__(self, 
                 workspace_dir: str,
                 kendra_index_id: str,
                 s3_bucket: str,
                 max_file_size_mb: int = 5):
        """
        Initialize the deep researcher
        
        Args:
            workspace_dir: Root directory of unpacked source code
            kendra_index_id: Kendra index for semantic search
            s3_bucket: S3 bucket for artifact storage
            max_file_size_mb: Maximum file size to analyze in MB
        """
        self.workspace_dir = Path(workspace_dir)
        self.kendra_index_id = kendra_index_id
        self.s3_bucket = s3_bucket
        self.max_file_size = max_file_size_mb * 1024 * 1024
        
        # AWS clients
        region = os.environ.get('AWS_REGION', 'us-east-1')
        self.kendra = boto3.client('kendra', region_name=region) if kendra_index_id else None
        self.s3 = boto3.client('s3', region_name=region) if s3_bucket else None
        
        # Research state
        self.file_catalog: Dict[str, FileMetadata] = {}
        self.dependency_graph: Dict[str, DependencyNode] = {}
        self.call_graph: Dict[str, CallGraphNode] = {}
        self.data_flows: List[DataFlow] = []
        self.detected_patterns: List[CodePattern] = []
        
        # Language mappings
        self.language_extensions = {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript',
            '.jsx': 'javascript',
            '.tsx': 'typescript',
            '.go': 'go',
            '.java': 'java',
            '.rb': 'ruby',
            '.php': 'php',
            '.cs': 'csharp',
            '.cpp': 'cpp',
            '.c': 'c',
            '.rs': 'rust',
            '.swift': 'swift',
            '.kt': 'kotlin',
        }
        
        # Security patterns to detect
        self.security_patterns = {
            'hardcoded_secret': [
                r'password\s*=\s*["\'][^"\']+["\']',
                r'api[_-]?key\s*=\s*["\'][^"\']+["\']',
                r'secret\s*=\s*["\'][^"\']+["\']',
                r'token\s*=\s*["\'][^"\']+["\']',
            ],
            'sql_injection': [
                r'execute\s*\(\s*["\'].*%s.*["\']',
                r'cursor\.execute\s*\([^)]*\+',
                r'SELECT.*FROM.*WHERE.*\+',
            ],
            'command_injection': [
                r'os\.system\s*\(',
                r'subprocess\.call\s*\(',
                r'exec\s*\(',
                r'eval\s*\(',
            ],
            'path_traversal': [
                r'open\s*\([^)]*\+',
                r'file\s*\([^)]*\+',
                r'\.\./|\.\.\\'
            ],
            'insecure_deserialization': [
                r'pickle\.loads?\s*\(',
                r'yaml\.load\s*\(',
                r'json\.loads?\s*\([^)]*user',
            ],
        }
    
    def catalog_repository(self) -> Dict[str, Any]:
        """
        Recursively catalog all files in the repository
        
        Returns:
            Repository summary with file statistics
        """
        print(f"[DeepResearcher] Cataloging repository: {self.workspace_dir}")
        
        stats = {
            'total_files': 0,
            'total_lines': 0,
            'languages': defaultdict(int),
            'file_types': defaultdict(int),
            'largest_files': [],
        }
        
        for root, dirs, files in os.walk(self.workspace_dir):
            # Skip hidden and vendor directories
            dirs[:] = [d for d in dirs if not d.startswith('.') 
                      and d not in ['node_modules', 'vendor', '__pycache__', 'venv']]
            
            for file in files:
                if file.startswith('.'):
                    continue
                
                file_path = Path(root) / file
                try:
                    metadata = self._analyze_file(file_path)
                    if metadata:
                        self.file_catalog[str(file_path)] = metadata
                        stats['total_files'] += 1
                        stats['total_lines'] += metadata.line_count
                        stats['languages'][metadata.language] += 1
                        stats['file_types'][metadata.extension] += 1
                        
                        if len(stats['largest_files']) < 10:
                            stats['largest_files'].append((str(file_path), metadata.size_bytes))
                            stats['largest_files'].sort(key=lambda x: x[1], reverse=True)
                
                except Exception as e:
                    print(f"[DeepResearcher] Error analyzing {file_path}: {e}")
                    continue
        
        print(f"[DeepResearcher] Cataloged {stats['total_files']} files, {stats['total_lines']} lines")
        return stats
    
    def _analyze_file(self, file_path: Path) -> Optional[FileMetadata]:
        """
        Analyze a single file and extract metadata
        
        Args:
            file_path: Path to file
            
        Returns:
            FileMetadata or None if file cannot be analyzed
        """
        # Check file size
        size = file_path.stat().st_size
        if size > self.max_file_size:
            return None
        
        # Determine language
        extension = file_path.suffix.lower()
        language = self.language_extensions.get(extension, 'unknown')
        
        if language == 'unknown':
            return None
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception:
            return None
        
        # Count lines
        lines = content.split('\n')
        line_count = len(lines)
        
        # Calculate hash
        hash_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
        
        # Extract code elements
        imports = []
        functions = []
        classes = []
        complexity = 0
        
        if language == 'python':
            try:
                tree = ast.parse(content)
                imports, functions, classes, complexity = self._analyze_python_ast(tree)
            except SyntaxError:
                pass
        
        relative_path = str(file_path.relative_to(self.workspace_dir))
        
        return FileMetadata(
            path=str(file_path),
            relative_path=relative_path,
            extension=extension,
            size_bytes=size,
            line_count=line_count,
            language=language,
            hash_sha256=hash_sha256,
            imports=imports,
            functions=functions,
            classes=classes,
            complexity_score=complexity,
        )
    
    def _analyze_python_ast(self, tree: ast.AST) -> Tuple[List[str], List[str], List[str], int]:
        """
        Analyze Python AST to extract imports, functions, classes, and complexity
        
        Args:
            tree: Python AST
            
        Returns:
            Tuple of (imports, functions, classes, complexity_score)
        """
        imports = []
        functions = []
        classes = []
        complexity = 0
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend([alias.name for alias in node.names])
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.append(node.module)
            elif isinstance(node, ast.FunctionDef):
                functions.append(node.name)
                complexity += self._calculate_complexity(node)
            elif isinstance(node, ast.ClassDef):
                classes.append(node.name)
        
        return imports, functions, classes, complexity
    
    def _calculate_complexity(self, node: ast.FunctionDef) -> int:
        """
        Calculate cyclomatic complexity of a function
        
        Args:
            node: Function AST node
            
        Returns:
            Complexity score
        """
        complexity = 1  # Base complexity
        
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.While, ast.For, ast.ExceptHandler)):
                complexity += 1
            elif isinstance(child, ast.BoolOp):
                complexity += len(child.values) - 1
        
        return complexity
    
    def build_dependency_graph(self) -> Dict[str, DependencyNode]:
        """
        Build dependency graph showing import relationships
        
        Returns:
            Dictionary of file paths to DependencyNode
        """
        print("[DeepResearcher] Building dependency graph...")
        
        for file_path, metadata in self.file_catalog.items():
            node = DependencyNode(
                file_path=file_path,
                imports=set(metadata.imports),
                functions=set(metadata.functions),
                classes=set(metadata.classes),
            )
            self.dependency_graph[file_path] = node
        
        # Build reverse dependencies
        for file_path, node in self.dependency_graph.items():
            for imported in node.imports:
                # Find files that export this import
                for other_path, other_node in self.dependency_graph.items():
                    if imported in other_node.functions or imported in other_node.classes:
                        other_node.imported_by.add(file_path)
        
        print(f"[DeepResearcher] Built dependency graph with {len(self.dependency_graph)} nodes")
        return self.dependency_graph
    
    def build_call_graph(self) -> Dict[str, CallGraphNode]:
        """
        Build call graph showing function call relationships
        
        Returns:
            Dictionary of function names to CallGraphNode
        """
        print("[DeepResearcher] Building call graph...")
        
        for file_path, metadata in self.file_catalog.items():
            if metadata.language != 'python':
                continue
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                tree = ast.parse(content)
                
                for node in ast.walk(tree):
                    if isinstance(node, ast.FunctionDef):
                        func_name = f"{metadata.relative_path}::{node.name}"
                        call_node = CallGraphNode(
                            function_name=node.name,
                            file_path=file_path,
                            line_number=node.lineno,
                            parameters=[arg.arg for arg in node.args.args],
                        )
                        
                        # Find function calls within this function
                        for child in ast.walk(node):
                            if isinstance(child, ast.Call):
                                if isinstance(child.func, ast.Name):
                                    call_node.calls.add(child.func.id)
                        
                        self.call_graph[func_name] = call_node
            
            except Exception as e:
                print(f"[DeepResearcher] Error building call graph for {file_path}: {e}")
                continue
        
        # Build reverse call relationships
        for func_name, node in self.call_graph.items():
            for called_func in node.calls:
                for other_name, other_node in self.call_graph.items():
                    if other_node.function_name == called_func:
                        other_node.called_by.add(func_name)
        
        print(f"[DeepResearcher] Built call graph with {len(self.call_graph)} nodes")
        return self.call_graph
    
    def detect_security_patterns(self) -> List[CodePattern]:
        """
        Scan codebase for security-relevant patterns
        
        Returns:
            List of detected code patterns
        """
        print("[DeepResearcher] Detecting security patterns...")
        
        patterns = []
        
        for file_path, metadata in self.file_catalog.items():
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                
                for line_num, line in enumerate(lines, 1):
                    for pattern_type, regexes in self.security_patterns.items():
                        for regex in regexes:
                            if re.search(regex, line, re.IGNORECASE):
                                pattern = CodePattern(
                                    pattern_type=pattern_type,
                                    file_path=metadata.relative_path,
                                    line_number=line_num,
                                    snippet=line.strip(),
                                    severity='high' if pattern_type in ['sql_injection', 'command_injection'] else 'medium',
                                    description=f"Potential {pattern_type.replace('_', ' ')} detected",
                                )
                                patterns.append(pattern)
            
            except Exception as e:
                print(f"[DeepResearcher] Error scanning {file_path}: {e}")
                continue
        
        self.detected_patterns = patterns
        print(f"[DeepResearcher] Detected {len(patterns)} security patterns")
        return patterns
    
    def query_kendra(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Query Kendra for semantic code search and historical context
        
        Args:
            query: Search query
            top_k: Number of results to return
            
        Returns:
            List of Kendra search results
        """
        print(f"[DeepResearcher] Querying Kendra: {query}")
        
        try:
            response = self.kendra.query(
                IndexId=self.kendra_index_id,
                QueryText=query,
                PageSize=top_k,
            )
            
            results = []
            for item in response.get('ResultItems', []):
                result = {
                    'title': item.get('DocumentTitle', {}).get('Text', ''),
                    'excerpt': item.get('DocumentExcerpt', {}).get('Text', ''),
                    'document_id': item.get('DocumentId', ''),
                    'score': item.get('ScoreAttributes', {}).get('ScoreConfidence', ''),
                    'attributes': item.get('DocumentAttributes', []),
                }
                results.append(result)
            
            print(f"[DeepResearcher] Found {len(results)} Kendra results")
            return results
        
        except ClientError as e:
            print(f"[DeepResearcher] Kendra query error: {e}")
            return []
    
    def synthesize_research(self, focus_areas: List[str]) -> Dict[str, Any]:
        """
        Synthesize comprehensive research report from multiple sources
        
        Args:
            focus_areas: List of areas to focus research on (e.g., ['authentication', 'api_security'])
            
        Returns:
            Comprehensive research synthesis
        """
        print(f"[DeepResearcher] Synthesizing research for: {focus_areas}")
        
        synthesis = {
            'catalog_summary': {
                'total_files': len(self.file_catalog),
                'languages': defaultdict(int),
                'total_functions': sum(len(m.functions) for m in self.file_catalog.values()),
                'total_classes': sum(len(m.classes) for m in self.file_catalog.values()),
                'avg_complexity': sum(m.complexity_score for m in self.file_catalog.values()) / max(len(self.file_catalog), 1),
            },
            'dependency_insights': {
                'most_imported_files': self._get_most_imported_files(top_k=5),
                'isolated_files': self._get_isolated_files(),
                'circular_dependencies': self._detect_circular_dependencies(),
            },
            'call_graph_insights': {
                'most_called_functions': self._get_most_called_functions(top_k=5),
                'entry_points': self._get_entry_points(),
                'dead_code_candidates': self._get_dead_code_candidates(),
            },
            'security_insights': {
                'patterns_by_severity': self._group_patterns_by_severity(),
                'high_risk_files': self._identify_high_risk_files(),
            },
            'kendra_context': {},
        }
        
        # Query Kendra for each focus area
        for area in focus_areas:
            synthesis['kendra_context'][area] = self.query_kendra(area, top_k=3)
        
        # Calculate language distribution
        for metadata in self.file_catalog.values():
            synthesis['catalog_summary']['languages'][metadata.language] += 1
        
        return synthesis
    
    def _get_most_imported_files(self, top_k: int = 5) -> List[Tuple[str, int]]:
        """Get files that are imported most frequently"""
        import_counts = [(node.file_path, len(node.imported_by)) 
                        for node in self.dependency_graph.values()]
        import_counts.sort(key=lambda x: x[1], reverse=True)
        return import_counts[:top_k]
    
    def _get_isolated_files(self) -> List[str]:
        """Get files with no imports or importers"""
        isolated = []
        for file_path, node in self.dependency_graph.items():
            if not node.imports and not node.imported_by:
                isolated.append(file_path)
        return isolated
    
    def _detect_circular_dependencies(self) -> List[List[str]]:
        """Detect circular dependency chains"""
        # Simplified circular dependency detection
        circles = []
        visited = set()
        
        def dfs(file_path: str, path: List[str]) -> None:
            if file_path in path:
                # Found circle
                circle_start = path.index(file_path)
                circles.append(path[circle_start:] + [file_path])
                return
            
            if file_path in visited:
                return
            
            visited.add(file_path)
            node = self.dependency_graph.get(file_path)
            
            if node:
                for imported in node.imports:
                    # Find file that provides this import
                    for other_path, other_node in self.dependency_graph.items():
                        if imported in other_node.functions or imported in other_node.classes:
                            dfs(other_path, path + [file_path])
        
        for file_path in self.dependency_graph:
            dfs(file_path, [])
        
        return circles[:5]  # Return top 5 circles
    
    def _get_most_called_functions(self, top_k: int = 5) -> List[Tuple[str, int]]:
        """Get functions that are called most frequently"""
        call_counts = [(node.function_name, len(node.called_by)) 
                      for node in self.call_graph.values()]
        call_counts.sort(key=lambda x: x[1], reverse=True)
        return call_counts[:top_k]
    
    def _get_entry_points(self) -> List[str]:
        """Get functions that are never called (potential entry points)"""
        entry_points = []
        for func_name, node in self.call_graph.items():
            if not node.called_by and node.function_name != '__init__':
                entry_points.append(func_name)
        return entry_points[:10]
    
    def _get_dead_code_candidates(self) -> List[str]:
        """Get functions that never call anything and are never called"""
        dead_code = []
        for func_name, node in self.call_graph.items():
            if not node.calls and not node.called_by and node.function_name not in ['__init__', 'main']:
                dead_code.append(func_name)
        return dead_code[:10]
    
    def _group_patterns_by_severity(self) -> Dict[str, int]:
        """Group detected patterns by severity"""
        severity_counts = defaultdict(int)
        for pattern in self.detected_patterns:
            severity_counts[pattern.severity] += 1
        return dict(severity_counts)
    
    def _identify_high_risk_files(self) -> List[Tuple[str, int]]:
        """Identify files with most security patterns"""
        file_pattern_counts = defaultdict(int)
        for pattern in self.detected_patterns:
            file_pattern_counts[pattern.file_path] += 1
        
        ranked = sorted(file_pattern_counts.items(), key=lambda x: x[1], reverse=True)
        return ranked[:10]
    
    def export_research_artifacts(self, mission_id: str) -> str:
        """
        Export all research artifacts to S3
        
        Args:
            mission_id: Mission ID for artifact naming
            
        Returns:
            S3 key of exported artifacts
        """
        print(f"[DeepResearcher] Exporting research artifacts for mission {mission_id}")
        
        artifacts = {
            'file_catalog': {path: {
                'relative_path': m.relative_path,
                'language': m.language,
                'line_count': m.line_count,
                'functions': m.functions,
                'classes': m.classes,
                'complexity': m.complexity_score,
            } for path, m in self.file_catalog.items()},
            'dependency_graph': {path: {
                'imports': list(node.imports),
                'imported_by': list(node.imported_by),
                'functions': list(node.functions),
                'classes': list(node.classes),
            } for path, node in self.dependency_graph.items()},
            'call_graph': {name: {
                'file_path': node.file_path,
                'line_number': node.line_number,
                'calls': list(node.calls),
                'called_by': list(node.called_by),
                'parameters': node.parameters,
            } for name, node in self.call_graph.items()},
            'security_patterns': [{
                'type': p.pattern_type,
                'file': p.file_path,
                'line': p.line_number,
                'snippet': p.snippet,
                'severity': p.severity,
                'description': p.description,
            } for p in self.detected_patterns],
        }
        
        # Upload to S3
        s3_key = f"research/{mission_id}/deep_research.json"
        
        try:
            self.s3.put_object(
                Bucket=self.s3_bucket,
                Key=s3_key,
                Body=json.dumps(artifacts, indent=2),
                ContentType='application/json',
            )
            print(f"[DeepResearcher] Exported artifacts to s3://{self.s3_bucket}/{s3_key}")
            return s3_key
        
        except ClientError as e:
            print(f"[DeepResearcher] Error exporting artifacts: {e}")
            raise