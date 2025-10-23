"""
Archaeologist Agent - Context Discovery and Metadata Extraction

This agent is responsible for:
1. Analyzing uploaded code structure
2. Identifying service criticality tier
3. Mapping data flow patterns
4. Extracting security-relevant metadata
5. Outputting ContextManifest for downstream agents
"""

import os
import json
import boto3
import logging
import redis
import time
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from pathlib import Path
from src.shared.cognitive_kernel.bedrock_client import CognitiveKernel
from src.shared.code_research.deep_researcher import DeepCodeResearcher

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class ContextManifest:
    """Output artifact from Archaeologist Agent with deep research."""
    mission_id: str
    scan_type: str  # 'code' or 'aws' - critical for tool selection
    service_name: str
    criticality_tier: int  # 0 (critical) to 3 (low)
    handles_pii: bool
    handles_payment: bool
    authentication_present: bool
    primary_languages: List[str]
    file_count: int
    total_lines: int
    key_files: List[str]
    dependencies: List[str]
    data_flows: List[Dict[str, str]]
    confidence_score: float
    research_artifacts_s3_key: str  # S3 key to deep research artifacts
    dependency_graph_summary: Dict[str, Any]  # Summary of dependency insights
    call_graph_summary: Dict[str, Any]  # Summary of call graph insights
    security_patterns_count: int  # Number of security patterns detected

class ArchaeologistAgent:
    """
    Autonomous agent for context discovery and metadata extraction.
    
    Implements the SENSE → THINK → DECIDE → ACT → REFLECT loop.
    """
    
    def __init__(self, scan_id: str = None):
        """Initialize agent with AWS clients and cognitive kernel."""
        self.mission_id = scan_id or os.environ.get('MISSION_ID', 'test-scan-123')
        self.scan_type = os.environ.get('SCAN_TYPE', 'code')  # Archaeologist only runs for code scans
        self.s3_artifacts_bucket = os.environ.get('S3_ARTIFACTS_BUCKET', 'hivemind-artifacts')
        self.redis_endpoint = os.environ.get('REDIS_ENDPOINT', 'localhost')
        self.redis_port = int(os.environ.get('REDIS_PORT', '6379'))
        self.kendra_index_id = os.environ.get('KENDRA_INDEX_ID', 'test-index-123')
        
        # AWS clients
        region = os.environ.get('AWS_REGION', 'us-east-1')
        
        # Configure boto3 client with retries and timeouts
        boto_config = Config(
            region_name=region,
            retries={'max_attempts': 3, 'mode': 'adaptive'},
            connect_timeout=10,
            read_timeout=60
        )
        
        self.s3_client = boto3.client('s3', config=boto_config)
        
        # Redis for agent state
        try:
            self.redis_client = redis.Redis(
                host=self.redis_endpoint,
                port=self.redis_port,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True
            )
            self.redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}. Agent will run without state tracking.")
            self.redis_client = None
        
        # Cognitive kernel for AI reasoning
        self.cognitive_kernel = CognitiveKernel(
            kendra_index_id=self.kendra_index_id
        )
        
        self.agent_state_key = f"agent:{self.mission_id}:archaeologist"
        
        logger.info(f"ArchaeologistAgent initialized for mission: {self.mission_id}")
    
    def run(self) -> ContextManifest:
        """
        Main execution loop: SENSE → THINK → DECIDE → ACT → REFLECT
        
        Returns:
            ContextManifest with discovered context
        """
        source_path = None
        try:
            # SENSE: Gather current state
            self._update_state("SENSING")
            source_path = self._download_source_code()
            
            # THINK: Analyze with AI
            self._update_state("THINKING")
            analysis = self._analyze_codebase(source_path)
            
            # DECIDE: Determine criticality and flags
            self._update_state("DECIDING")
            manifest = self._decide_context(analysis)
            
            # ACT: Write output
            self._update_state("ACTING")
            self._write_output(manifest)
            
            # REFLECT: Update confidence
            self._update_state("REFLECTING")
            self._reflect_on_decision(manifest)
            
            # COMPLETED
            self._update_state("COMPLETED", manifest.confidence_score)
            
            logger.info(f"ArchaeologistAgent completed. Confidence: {manifest.confidence_score}")
            
            return manifest
            
        except Exception as e:
            logger.error(f"ArchaeologistAgent failed: {str(e)}", exc_info=True)
            self._update_state("FAILED", error=str(e))
            raise
        finally:
            # Cleanup downloaded code
            if source_path and source_path.exists():
                try:
                    import shutil
                    shutil.rmtree(source_path)
                    logger.info(f"Cleaned up downloaded code at {source_path}")
                except Exception as e:
                    logger.warning(f"Error cleaning up code directory: {e}")
    
    def _update_state(
        self,
        status: str,
        confidence: float = 0.0,
        error: Optional[str] = None
    ):
        """Update agent state in Redis."""
        if not self.redis_client:
            logger.debug(f"State update skipped (no Redis): {status}")
            return
        
        state = {
            'status': status,
            'last_heartbeat': str(int(time.time())),
            'confidence_score': str(confidence)
        }
        
        if error:
            state['error_message'] = error
        
        if self.redis_client:
            try:
                self.redis_client.hset(self.agent_state_key, mapping=state)
                # Set 24-hour TTL on agent state to prevent memory leak
                self.redis_client.expire(self.agent_state_key, 86400)
                
                active_agents_key = f"mission:{self.mission_id}:active_agents"
                if status not in ['COMPLETED', 'FAILED']:
                    self.redis_client.sadd(active_agents_key, "archaeologist")
                    # Set 24-hour TTL on active agents set to prevent memory leak
                    self.redis_client.expire(active_agents_key, 86400)
            except Exception as e:
                logger.warning(f"Redis state update failed: {e}")
    
    def _download_source_code(self) -> Path:
        """Download and extract source code from S3."""
        local_path = Path(f"/tmp/{self.mission_id}")
        local_path.mkdir(parents=True, exist_ok=True)
        
        # List all files in unzipped directory
        paginator = self.s3_client.get_paginator('list_objects_v2')
        prefix = f"unzipped/{self.mission_id}/"
        
        for page in paginator.paginate(Bucket=self.s3_artifacts_bucket, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                relative_path = key[len(prefix):]
                
                if not relative_path:
                    continue
                
                file_path = local_path / relative_path
                file_path.parent.mkdir(parents=True, exist_ok=True)
                
                self.s3_client.download_file(
                    self.s3_artifacts_bucket,
                    key,
                    str(file_path)
                )
        
        logger.info(f"Downloaded source code to {local_path}")
        return local_path
    
    def _analyze_codebase(self, source_path: Path) -> Dict[str, Any]:
        """
        Perform deep analysis of codebase using DeepCodeResearcher.
        
        Args:
            source_path: Path to extracted source code
            
        Returns:
            Dictionary with comprehensive analysis results
        """
        logger.info("Initializing DeepCodeResearcher for comprehensive analysis")
        
        # Initialize deep researcher
        deep_researcher = DeepCodeResearcher(
            workspace_dir=str(source_path),
            kendra_index_id=self.kendra_index_id,
            s3_bucket=self.s3_artifacts_bucket,
            max_file_size_mb=5
        )
        
        # Step 1: Catalog all files recursively
        logger.info("Step 1/6: Cataloging repository files...")
        catalog_stats = deep_researcher.catalog_repository()
        
        # Step 2: Build dependency graph
        logger.info("Step 2/6: Building dependency graph...")
        dependency_graph = deep_researcher.build_dependency_graph()
        
        # Step 3: Build call graph
        logger.info("Step 3/6: Building call graph...")
        call_graph = deep_researcher.build_call_graph()
        
        # Step 4: Detect security patterns
        logger.info("Step 4/6: Detecting security patterns...")
        security_patterns = deep_researcher.detect_security_patterns()
        
        # Step 5: Query Kendra for historical context
        logger.info("Step 5/6: Querying institutional memory...")
        focus_areas = [
            'authentication patterns',
            'PII handling',
            'payment processing',
            'service criticality',
            'security vulnerabilities',
        ]
        
        # Step 6: Synthesize research from all sources
        logger.info("Step 6/6: Synthesizing research findings...")
        research_synthesis = deep_researcher.synthesize_research(focus_areas)
        
        # Export research artifacts to S3
        logger.info("Exporting research artifacts to S3...")
        artifacts_key = deep_researcher.export_research_artifacts(self.mission_id)
        
        # Identify key files from research
        key_files = self._identify_key_files_from_research(
            research_synthesis,
            dependency_graph,
            call_graph
        )
        
        # Extract dependencies
        dependencies = self._extract_dependencies_from_research(research_synthesis)
        
        # Read sample code for AI analysis (now informed by research)
        sample_code = self._sample_strategic_code_files(
            deep_researcher.file_catalog,
            key_files,
            max_files=10
        )
        
        # Query Kendra for similar past analyses
        kendra_context = self.cognitive_kernel.retrieve_from_kendra(
            query=f"code analysis context discovery service metadata {' '.join(catalog_stats['languages'].keys())}",
            top_k=3
        )
        
        # Prepare comprehensive context for AI
        security_summary = self._format_security_patterns(security_patterns)
        dependency_insights = self._format_dependency_insights(research_synthesis['dependency_insights'])
        call_graph_insights = self._format_call_graph_insights(research_synthesis['call_graph_insights'])
        
        # Invoke AI for deep analysis with full research context
        system_prompt = """You are the ArchaeologistAgent, a specialized AI for analyzing codebases and extracting security-relevant metadata.

You have access to comprehensive deep research results including:
- Complete file catalog with complexity metrics
- Dependency graph showing import relationships
- Call graph showing function relationships
- Security pattern detection results
- Historical context from institutional memory

Your task is to synthesize all this information to determine:
1. Service criticality tier (0=critical, 1=high, 2=medium, 3=low)
2. Whether it handles PII (personally identifiable information)
3. Whether it handles payment data
4. Whether authentication is present
5. Primary programming languages
6. Key data flows

Be precise and cite specific files, patterns, or research findings you observe."""

        user_prompt = f"""Analyze this codebase using comprehensive deep research:

=== CATALOG STATISTICS ===
Total Files: {catalog_stats['total_files']}
Total Lines: {catalog_stats['total_lines']}
Languages: {dict(catalog_stats['languages'])}
Average Complexity: {research_synthesis['catalog_summary']['avg_complexity']:.2f}

=== KEY FILES (Most Imported) ===
{chr(10).join([f"{path} (imported by {count} files)" for path, count in research_synthesis['dependency_insights']['most_imported_files']])}

=== SECURITY PATTERNS DETECTED ===
{security_summary}

=== DEPENDENCY INSIGHTS ===
{dependency_insights}

=== CALL GRAPH INSIGHTS ===
{call_graph_insights}

=== STRATEGIC CODE SAMPLES ===
{sample_code}

=== HISTORICAL CONTEXT FROM KENDRA ===
{self._format_kendra_results(kendra_context)}

=== KENDRA FOCUS AREA RESEARCH ===
{self._format_research_context(research_synthesis['kendra_context'])}

Provide your analysis in JSON format:
{{
  "criticality_tier": 0-3,
  "handles_pii": true/false,
  "handles_payment": true/false,
  "authentication_present": true/false,
  "primary_languages": ["python", "javascript"],
  "data_flows": [{{"from": "source", "to": "destination", "type": "data_type"}}],
  "reasoning": "explanation based on research findings",
  "confidence": 0.0-1.0,
  "research_artifacts_s3_key": "{artifacts_key}"
}}"""

        response = self.cognitive_kernel.invoke_claude(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=4096,  # More tokens for comprehensive analysis
            temperature=0.2  # Even lower temperature for factual synthesis
        )
        
        # Parse AI response
        try:
            ai_analysis = json.loads(response.content)
        except json.JSONDecodeError:
            logger.warning("Failed to parse AI response, using defaults")
            ai_analysis = {
                "criticality_tier": 2,
                "handles_pii": False,
                "handles_payment": False,
                "authentication_present": False,
                "primary_languages": ["unknown"],
                "data_flows": [],
                "confidence": 0.5
            }
        
        return {
            "file_count": catalog_stats['total_files'],
            "total_lines": catalog_stats['total_lines'],
            "key_files": key_files,
            "dependencies": dependencies,
            "ai_analysis": ai_analysis,
            "research_synthesis": research_synthesis,
            "artifacts_key": artifacts_key,
            "security_patterns_count": len(security_patterns)
        }
    
    def _decide_context(self, analysis: Dict[str, Any]) -> ContextManifest:
        """Create ContextManifest from analysis with deep research."""
        ai = analysis['ai_analysis']
        research = analysis['research_synthesis']
        
        manifest = ContextManifest(
            mission_id=self.mission_id,
            scan_type=self.scan_type,
            service_name=os.environ.get('REPO_NAME', 'unknown'),
            criticality_tier=ai.get('criticality_tier', 2),
            handles_pii=ai.get('handles_pii', False),
            handles_payment=ai.get('handles_payment', False),
            authentication_present=ai.get('authentication_present', False),
            primary_languages=ai.get('primary_languages', []),
            file_count=analysis['file_count'],
            total_lines=analysis['total_lines'],
            key_files=analysis['key_files'],
            dependencies=analysis['dependencies'],
            data_flows=ai.get('data_flows', []),
            confidence_score=ai.get('confidence', 0.7),
            research_artifacts_s3_key=ai.get('research_artifacts_s3_key', analysis['artifacts_key']),
            dependency_graph_summary=research['dependency_insights'],
            call_graph_summary=research['call_graph_insights'],
            security_patterns_count=analysis['security_patterns_count']
        )
        
        return manifest
    
    def _write_output(self, manifest: ContextManifest):
        """Write ContextManifest to S3."""
        output_key = f"agent-outputs/archaeologist/{self.mission_id}/context-manifest.json"
        
        self.s3_client.put_object(
            Bucket=self.s3_artifacts_bucket,
            Key=output_key,
            Body=json.dumps(asdict(manifest), indent=2),
            ContentType='application/json'
        )
        
        # Update Redis with output location
        if self.redis_client:
            try:
                self.redis_client.hset(
                    self.agent_state_key,
                    'output_s3_uri',
                    f"s3://{self.s3_artifacts_bucket}/{output_key}"
                )
            except Exception as e:
                logger.warning(f"Failed to update Redis with output location: {e}")
        
        logger.info(f"ContextManifest written to s3://{self.s3_artifacts_bucket}/{output_key}")
    
    def _reflect_on_decision(self, manifest: ContextManifest):
        """Reflect on decision quality and log insights."""
        decision_log = {
            'agent': 'archaeologist',
            'decision': 'context_discovery',
            'confidence': manifest.confidence_score,
            'criticality': manifest.criticality_tier,
            'timestamp': str(int(time.time()))
        }
        
        if self.redis_client:
            decision_key = f"agent:{self.mission_id}:archaeologist:decisions"
            try:
                self.redis_client.rpush(
                    decision_key,
                    json.dumps(decision_log)
                )
                # Set 24-hour TTL on decision list to prevent memory leak
                self.redis_client.expire(decision_key, 86400)
            except Exception as e:
                logger.warning(f"Failed to log decision to Redis: {e}")
        
        logger.info(f"Reflection: {decision_log}")
    
    def _identify_key_files(self, files: List[Path]) -> List[str]:
        """Identify key files (main, config, auth, etc.)."""
        key_patterns = ['main', 'app', 'server', 'auth', 'config', 'settings']
        key_files = []
        
        for f in files:
            if any(pattern in f.name.lower() for pattern in key_patterns):
                key_files.append(str(f.name))
        
        return key_files[:10]
    
    def _extract_dependencies(self, source_path: Path) -> List[str]:
        """Extract dependencies from package files."""
        dependencies = []
        
        # Python
        requirements_file = source_path / 'requirements.txt'
        if requirements_file.exists():
            deps = requirements_file.read_text().splitlines()
            dependencies.extend([d.split('==')[0] for d in deps if d and not d.startswith('#')])
        
        # Node.js
        package_json = source_path / 'package.json'
        if package_json.exists():
            try:
                pkg = json.loads(package_json.read_text())
                dependencies.extend(pkg.get('dependencies', {}).keys())
            except Exception:
                pass
        
        return dependencies[:50]
    
    def _sample_code_files(self, files: List[Path], max_files: int = 10) -> str:
        """Sample code from key files."""
        samples = []
        
        for f in files[:max_files]:
            try:
                content = f.read_text(errors='ignore')
                samples.append(f"File: {f.name}\n{content[:500]}...\n")
            except Exception:
                continue
        
        return "\n".join(samples)
    
    def _format_kendra_results(self, context) -> str:
        """Format Kendra context for prompt."""
        if not context or not context.documents:
            return "No relevant historical context found."
        
        formatted = []
        for doc in context.documents[:3]:
            formatted.append(f"- {doc['title']}: {doc['excerpt'][:200]}...")
        
        return "\n".join(formatted)
    
    def _identify_key_files_from_research(
        self,
        research_synthesis: Dict[str, Any],
        dependency_graph: Dict,
        call_graph: Dict
    ) -> List[str]:
        """Identify key files from deep research results."""
        key_files = []
        
        # Add most imported files
        for file_path, _ in research_synthesis['dependency_insights']['most_imported_files']:
            key_files.append(file_path)
        
        # Add files with most security patterns
        for file_path, _ in research_synthesis['security_insights']['high_risk_files']:
            key_files.append(file_path)
        
        # Add entry point files
        for func_name in research_synthesis['call_graph_insights']['entry_points'][:5]:
            if '::' in func_name:
                file_path = func_name.split('::')[0]
                if file_path not in key_files:
                    key_files.append(file_path)
        
        return key_files[:15]  # Top 15 key files
    
    def _extract_dependencies_from_research(self, research_synthesis: Dict[str, Any]) -> List[str]:
        """Extract unique dependencies from research."""
        dependencies = set()
        
        for lang, count in research_synthesis['catalog_summary']['languages'].items():
            dependencies.add(f"{lang} ({count} files)")
        
        return list(dependencies)
    
    def _sample_strategic_code_files(
        self,
        file_catalog: Dict,
        key_files: List[str],
        max_files: int = 10
    ) -> str:
        """Sample code from strategically important files."""
        samples = []
        
        # Prioritize key files
        for file_path in key_files[:max_files]:
            if file_path in file_catalog:
                try:
                    with open(file_catalog[file_path].path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        # Take first 100 lines
                        lines = content.split('\n')[:100]
                        samples.append(f"\n=== {file_catalog[file_path].relative_path} ===\n" + '\n'.join(lines))
                except Exception:
                    continue
        
        return '\n'.join(samples)
    
    def _format_security_patterns(self, patterns: List) -> str:
        """Format security patterns for AI prompt."""
        if not patterns:
            return "No security patterns detected."
        
        by_severity = {}
        for pattern in patterns:
            severity = pattern.severity
            if severity not in by_severity:
                by_severity[severity] = []
            by_severity[severity].append(pattern)
        
        result = []
        for severity in ['high', 'medium', 'low']:
            if severity in by_severity:
                result.append(f"\n{severity.upper()} Severity ({len(by_severity[severity])} findings):")
                for pattern in by_severity[severity][:5]:  # Top 5 per severity
                    result.append(f"  - {pattern.pattern_type} in {pattern.file_path}:{pattern.line_number}")
                    result.append(f"    {pattern.snippet[:80]}...")
        
        return '\n'.join(result)
    
    def _format_dependency_insights(self, insights: Dict[str, Any]) -> str:
        """Format dependency insights for AI prompt."""
        result = []
        
        result.append(f"Most Imported Files: {len(insights['most_imported_files'])}")
        for file_path, count in insights['most_imported_files'][:5]:
            result.append(f"  - {file_path} (imported by {count} files)")
        
        if insights['isolated_files']:
            result.append(f"\nIsolated Files: {len(insights['isolated_files'])}")
        
        if insights['circular_dependencies']:
            result.append(f"\nCircular Dependencies Detected: {len(insights['circular_dependencies'])}")
            for circle in insights['circular_dependencies'][:3]:
                result.append(f"  - {' → '.join(circle[:3])}...")
        
        return '\n'.join(result)
    
    def _format_call_graph_insights(self, insights: Dict[str, Any]) -> str:
        """Format call graph insights for AI prompt."""
        result = []
        
        result.append(f"Most Called Functions:")
        for func_name, count in insights['most_called_functions'][:5]:
            result.append(f"  - {func_name} (called by {count} functions)")
        
        if insights['entry_points']:
            result.append(f"\nEntry Points: {len(insights['entry_points'])}")
            for entry in insights['entry_points'][:5]:
                result.append(f"  - {entry}")
        
        if insights['dead_code_candidates']:
            result.append(f"\nPotential Dead Code: {len(insights['dead_code_candidates'])} functions")
        
        return '\n'.join(result)
    
    def _format_research_context(self, kendra_context: Dict[str, Any]) -> str:
        """Format Kendra research context for AI prompt."""
        result = []
        
        for area, results in kendra_context.items():
            result.append(f"\n{area.upper()}:")
            for i, res in enumerate(results, 1):
                result.append(f"  {i}. {res['title']}")
                result.append(f"     {res['excerpt'][:150]}...")
        
        return '\n'.join(result)

def main():
    """Main entry point for agent container."""
    agent = ArchaeologistAgent()
    manifest = agent.run()
    # Output JSON for Step Functions to capture
    output = {
        'mission_id': manifest.mission_id,
        'confidence': manifest.confidence_score,
        'file_count': manifest.file_count,
        'criticality_tier': manifest.criticality_tier
    }
    print(json.dumps(output))
    return 0

if __name__ == "__main__":
    exit(main())