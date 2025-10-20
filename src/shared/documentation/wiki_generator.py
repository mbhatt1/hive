"""
Security-Focused Wiki Generator for Hivemind-Prism

Generates beautiful, interactive documentation wikis that include:
- Executive summary with security posture
- Architecture diagrams from dependency/call graphs  
- File-by-file documentation with security context
- Security findings organized by severity
- Remediation recommendations
- Interactive Mermaid diagrams
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional
from pathlib import Path
from dataclasses import dataclass
import boto3
from botocore.exceptions import ClientError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class WikiPage:
    """Represents a single wiki page"""
    title: str
    content: str
    path: str  # Relative path in wiki structure
    children: List['WikiPage'] = None
    
    def __post_init__(self):
        if self.children is None:
            self.children = []


@dataclass
class SecurityWiki:
    """Complete security wiki structure"""
    mission_id: str
    title: str
    summary: str
    security_posture: Dict[str, Any]
    pages: List[WikiPage]
    created_at: str


class SecurityWikiGenerator:
    """
    Generates comprehensive security documentation wikis
    """
    
    def __init__(self, mission_id: str, s3_bucket: str):
        """
        Initialize wiki generator
        
        Args:
            mission_id: Mission ID for artifact retrieval
            s3_bucket: S3 bucket for input/output artifacts
        """
        self.mission_id = mission_id
        self.s3_bucket = s3_bucket
        self.s3 = boto3.client('s3')
        
        logger.info(f"SecurityWikiGenerator initialized for mission {mission_id}")
    
    def generate_wiki(
        self,
        research_artifacts_key: str,
        findings_key: str,
        context_manifest: Dict[str, Any]
    ) -> SecurityWiki:
        """
        Generate complete security wiki from research and findings
        
        Args:
            research_artifacts_key: S3 key to deep research artifacts
            findings_key: S3 key to final security findings
            context_manifest: Context manifest from Archaeologist
            
        Returns:
            SecurityWiki object
        """
        logger.info("Generating security wiki...")
        
        # Load artifacts
        research = self._load_s3_json(research_artifacts_key)
        findings = self._load_s3_json(findings_key)
        
        # Generate wiki pages
        pages = []
        
        # 1. Executive Summary
        pages.append(self._generate_executive_summary(context_manifest, findings))
        
        # 2. Security Posture
        pages.append(self._generate_security_posture(findings, research))
        
        # 3. Architecture Overview
        pages.append(self._generate_architecture_overview(research, context_manifest))
        
        # 4. Code Structure
        pages.append(self._generate_code_structure(research))
        
        # 5. Security Findings
        pages.append(self._generate_findings_section(findings))
        
        # 6. Remediation Guide
        pages.append(self._generate_remediation_guide(findings))
        
        # 7. File Documentation
        pages.append(self._generate_file_documentation(research))
        
        # Calculate overall security posture
        security_posture = self._calculate_security_posture(findings, context_manifest)
        
        wiki = SecurityWiki(
            mission_id=self.mission_id,
            title=f"Security Analysis: {context_manifest.get('service_name', 'Unknown')}",
            summary=self._generate_wiki_summary(context_manifest, findings),
            security_posture=security_posture,
            pages=pages,
            created_at=str(int(os.times().elapsed))
        )
        
        logger.info(f"Generated wiki with {len(pages)} top-level pages")
        return wiki
    
    def _generate_executive_summary(
        self,
        context_manifest: Dict[str, Any],
        findings: Dict[str, Any]
    ) -> WikiPage:
        """Generate executive summary page"""
        
        total_findings = len(findings.get('findings', []))
        critical = sum(1 for f in findings.get('findings', []) if f.get('severity') == 'CRITICAL')
        high = sum(1 for f in findings.get('findings', []) if f.get('severity') == 'HIGH')
        
        content = f"""# Executive Summary

## Overview
**Service**: {context_manifest.get('service_name', 'Unknown')}  
**Analysis Date**: {findings.get('timestamp', 'N/A')}  
**Criticality Tier**: {self._format_criticality(context_manifest.get('criticality_tier', 2))}  
**Total Findings**: {total_findings}

## Security Posture

```mermaid
pie title Finding Distribution
    "Critical" : {critical}
    "High" : {high}
    "Medium" : {total_findings - critical - high}
```

## Key Metrics
- **Files Analyzed**: {context_manifest.get('file_count', 0)}
- **Total Lines of Code**: {context_manifest.get('total_lines', 0):,}
- **Primary Languages**: {', '.join(context_manifest.get('primary_languages', []))}
- **Security Patterns Detected**: {context_manifest.get('security_patterns_count', 0)}

## Risk Profile
- **PII Handling**: {'⚠️ Yes' if context_manifest.get('handles_pii') else '✅ No'}
- **Payment Processing**: {'⚠️ Yes' if context_manifest.get('handles_payment') else '✅ No'}
- **Authentication Present**: {'✅ Yes' if context_manifest.get('authentication_present') else '⚠️ No'}

## Immediate Actions Required
{self._generate_immediate_actions(findings)}

## Next Steps
1. Review critical and high-severity findings
2. Implement recommended mitigations
3. Conduct targeted security testing
4. Update security controls as needed

---
*This analysis was performed by Hivemind-Prism, an agentic security intelligence platform.*
"""
        
        return WikiPage(
            title="Executive Summary",
            content=content,
            path="00-executive-summary.md"
        )
    
    def _generate_security_posture(
        self,
        findings: Dict[str, Any],
        research: Dict[str, Any]
    ) -> WikiPage:
        """Generate detailed security posture analysis"""
        
        findings_list = findings.get('findings', [])
        
        # Group findings by category
        by_category = {}
        for f in findings_list:
            cat = f.get('category', 'Other')
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(f)
        
        content = f"""# Security Posture Analysis

## Overall Assessment

### Threat Landscape
This analysis examined the application across multiple security dimensions including:
- Code quality and security patterns
- Dependency vulnerabilities
- Secret management
- Authentication and authorization
- Data flow security

### Findings Breakdown

| Severity | Count | Percentage |
|----------|-------|------------|
| Critical | {sum(1 for f in findings_list if f.get('severity') == 'CRITICAL')} | {self._calc_percentage(findings_list, 'CRITICAL')}% |
| High | {sum(1 for f in findings_list if f.get('severity') == 'HIGH')} | {self._calc_percentage(findings_list, 'HIGH')}% |
| Medium | {sum(1 for f in findings_list if f.get('severity') == 'MEDIUM')} | {self._calc_percentage(findings_list, 'MEDIUM')}% |
| Low | {sum(1 for f in findings_list if f.get('severity') == 'LOW')} | {self._calc_percentage(findings_list, 'LOW')}% |

## Category Analysis

```mermaid
graph LR
    A[Security Analysis] --> B[Code Patterns]
    A --> C[Dependencies]
    A --> D[Secrets]
    A --> E[Architecture]
    
    B --> B1[{sum(1 for f in by_category.get('code_pattern', []))} findings]
    C --> C1[{sum(1 for f in by_category.get('dependency', []))} findings]
    D --> D1[{sum(1 for f in by_category.get('secret', []))} findings]
    E --> E1[{sum(1 for f in by_category.get('architecture', []))} findings]
```

### Detailed Category Breakdown

{self._format_category_breakdown(by_category)}

## Security Strengths
{self._identify_strengths(research, findings)}

## Areas of Concern
{self._identify_concerns(findings)}

## Compliance Considerations
{self._assess_compliance(findings, research)}
"""
        
        return WikiPage(
            title="Security Posture",
            content=content,
            path="01-security-posture.md"
        )
    
    def _generate_architecture_overview(
        self,
        research: Dict[str, Any],
        context_manifest: Dict[str, Any]
    ) -> WikiPage:
        """Generate architecture overview with diagrams"""
        
        dep_insights = research.get('dependency_graph', {})
        call_insights = research.get('call_graph', {})
        
        # Get most imported files for architecture diagram
        most_imported = []
        for file_path, data in dep_insights.items():
            imported_by_count = len(data.get('imported_by', []))
            if imported_by_count > 0:
                most_imported.append((file_path, imported_by_count))
        
        most_imported.sort(key=lambda x: x[1], reverse=True)
        top_files = most_imported[:10]
        
        content = f"""# Architecture Overview

## System Architecture

### Dependency Graph
The following diagram shows the most central files in the codebase based on import relationships:

```mermaid
graph TD
    subgraph "Core Components"
    {self._generate_dependency_mermaid(top_files[:5], dep_insights)}
    end
    
    subgraph "Supporting Modules"
    {self._generate_dependency_mermaid(top_files[5:10], dep_insights)}
    end
```

## Component Analysis

### Most Imported Files
These files are central to the application's architecture:

| File | Imported By | Functions | Classes |
|------|-------------|-----------|---------|
{self._format_component_table(top_files, dep_insights)}

### Entry Points
Functions that are never called internally (potential entry points):

{self._format_entry_points(call_insights)}

### Module Structure

```mermaid
graph LR
    A[Application] --> B[Core Logic]
    A --> C[API Layer]
    A --> D[Data Layer]
    A --> E[Utilities]
    
    B --> B1[{context_manifest.get('file_count', 0)} files]
    C --> C1[External Interfaces]
    D --> D1[Persistence]
    E --> E1[Helpers]
```

## Data Flow

### Identified Data Flows
{self._format_data_flows(context_manifest.get('data_flows', []))}

## Technology Stack

### Primary Languages
{chr(10).join([f'- **{lang}**' for lang in context_manifest.get('primary_languages', [])])}

### Dependencies
{self._format_key_dependencies(research.get('file_catalog', {}))}
"""
        
        return WikiPage(
            title="Architecture Overview",
            content=content,
            path="02-architecture.md"
        )
    
    def _generate_code_structure(self, research: Dict[str, Any]) -> WikiPage:
        """Generate code structure documentation"""
        
        file_catalog = research.get('file_catalog', {})
        
        # Group files by language
        by_language = {}
        for file_path, metadata in file_catalog.items():
            lang = metadata.get('language', 'unknown')
            if lang not in by_language:
                by_language[lang] = []
            by_language[lang].append(metadata)
        
        # Calculate complexity metrics
        total_complexity = sum(m.get('complexity', 0) for m in file_catalog.values())
        avg_complexity = total_complexity / max(len(file_catalog), 1)
        
        content = f"""# Code Structure

## Overview
Total Files: {len(file_catalog)}  
Average Complexity: {avg_complexity:.2f}  
Total Functions: {sum(len(m.get('functions', [])) for m in file_catalog.values())}  
Total Classes: {sum(len(m.get('classes', [])) for m in file_catalog.values())}

## Language Distribution

```mermaid
pie title Code Distribution by Language
{self._generate_language_pie(by_language)}
```

## Complexity Analysis

### High Complexity Files
Files with complexity score > 10:

{self._format_complex_files(file_catalog)}

## File Organization

### Directory Structure
```
{self._generate_directory_tree(file_catalog)}
```

## Code Quality Metrics

| Metric | Value | Assessment |
|--------|-------|------------|
| Average File Size | {self._calc_avg_file_size(file_catalog)} lines | {self._assess_file_size(file_catalog)} |
| Average Complexity | {avg_complexity:.2f} | {self._assess_complexity(avg_complexity)} |
| Function Count | {sum(len(m.get('functions', [])) for m in file_catalog.values())} | - |
| Class Count | {sum(len(m.get('classes', [])) for m in file_catalog.values())} | - |

## Language-Specific Details

{self._format_language_details(by_language)}
"""
        
        return WikiPage(
            title="Code Structure",
            content=content,
            path="03-code-structure.md"
        )
    
    def _generate_findings_section(self, findings: Dict[str, Any]) -> WikiPage:
        """Generate detailed security findings section"""
        
        findings_list = findings.get('findings', [])
        
        # Group by severity
        by_severity = {
            'CRITICAL': [],
            'HIGH': [],
            'MEDIUM': [],
            'LOW': []
        }
        
        for f in findings_list:
            severity = f.get('severity', 'LOW')
            if severity in by_severity:
                by_severity[severity].append(f)
        
        content = f"""# Security Findings

## Summary
Total Findings: {len(findings_list)}

## Critical Findings ({len(by_severity['CRITICAL'])})

{self._format_findings_by_severity(by_severity['CRITICAL'], 'CRITICAL')}

## High Severity Findings ({len(by_severity['HIGH'])})

{self._format_findings_by_severity(by_severity['HIGH'], 'HIGH')}

## Medium Severity Findings ({len(by_severity['MEDIUM'])})

{self._format_findings_by_severity(by_severity['MEDIUM'], 'MEDIUM')}

## Low Severity Findings ({len(by_severity['LOW'])})

{self._format_findings_by_severity(by_severity['LOW'], 'LOW')}

## Attack Scenarios

{self._generate_attack_scenarios(findings_list)}
"""
        
        children = []
        
        # Create child pages for each critical/high finding
        for i, finding in enumerate(by_severity['CRITICAL'] + by_severity['HIGH']):
            child_page = self._generate_finding_detail_page(finding, i)
            children.append(child_page)
        
        return WikiPage(
            title="Security Findings",
            content=content,
            path="04-findings.md",
            children=children
        )
    
    def _generate_remediation_guide(self, findings: Dict[str, Any]) -> WikiPage:
        """Generate remediation guide"""
        
        findings_list = findings.get('findings', [])
        
        # Group by category for remediation
        by_category = {}
        for f in findings_list:
            cat = f.get('category', 'Other')
            if cat not in by_category:
                by_category[cat] = []
            by_category[cat].append(f)
        
        content = f"""# Remediation Guide

## Priority Roadmap

```mermaid
gantt
    title Security Remediation Timeline
    dateFormat  YYYY-MM-DD
    section Critical
    Fix Critical Issues :crit, 2024-01-01, 7d
    section High
    Address High Severity :active, 2024-01-08, 14d
    section Medium
    Resolve Medium Issues : 2024-01-22, 30d
    section Low
    Handle Low Priority : 2024-02-21, 30d
```

## Remediation by Category

{self._format_remediation_by_category(by_category)}

## Best Practices

### Secure Coding Standards
1. **Input Validation**: Validate all user inputs
2. **Output Encoding**: Encode outputs to prevent injection
3. **Authentication**: Implement multi-factor authentication
4. **Authorization**: Use principle of least privilege
5. **Cryptography**: Use strong, up-to-date algorithms

### Security Testing
1. Implement automated security scanning in CI/CD
2. Conduct regular penetration testing
3. Perform code reviews with security focus
4. Use static analysis tools continuously

### Monitoring & Response
1. Implement comprehensive logging
2. Set up security monitoring alerts
3. Establish incident response procedures
4. Conduct security drills regularly

## Quick Wins
High-impact, low-effort improvements:

{self._identify_quick_wins(findings_list)}

## Long-term Improvements
Strategic security enhancements:

{self._identify_strategic_improvements(findings_list)}
"""
        
        return WikiPage(
            title="Remediation Guide",
            content=content,
            path="05-remediation.md"
        )
    
    def _generate_file_documentation(self, research: Dict[str, Any]) -> WikiPage:
        """Generate file-by-file documentation"""
        
        file_catalog = research.get('file_catalog', {})
        security_patterns = research.get('security_patterns', [])
        
        # Group security patterns by file
        patterns_by_file = {}
        for pattern in security_patterns:
            file_path = pattern.get('file')
            if file_path not in patterns_by_file:
                patterns_by_file[file_path] = []
            patterns_by_file[file_path].append(pattern)
        
        content = f"""# File Documentation

## Overview
This section provides detailed documentation for each file in the codebase, including:
- Purpose and functionality
- Security concerns
- Dependencies
- Code metrics

## Files

{self._generate_file_index(file_catalog, patterns_by_file)}

---

## Detailed File Documentation

{self._generate_detailed_file_docs(file_catalog, patterns_by_file)}
"""
        
        return WikiPage(
            title="File Documentation",
            content=content,
            path="06-files.md"
        )
    
    def _generate_finding_detail_page(self, finding: Dict[str, Any], index: int) -> WikiPage:
        """Generate detailed page for a single finding"""
        
        title = finding.get('title', f'Finding {index + 1}')
        severity = finding.get('severity', 'MEDIUM')
        category = finding.get('category', 'Other')
        
        content = f"""# {title}

## Overview
**Severity**: {severity}  
**Category**: {category}  
**CWE**: {finding.get('cwe', 'N/A')}  
**CVSS Score**: {finding.get('cvss_score', 'N/A')}

## Description
{finding.get('description', 'No description provided')}

## Location
**File**: {finding.get('file', 'Multiple files')}  
**Line**: {finding.get('line', 'N/A')}

## Evidence
```
{finding.get('evidence', 'No evidence provided')}
```

## Impact
{finding.get('impact', 'Potential security vulnerability that could be exploited by attackers.')}

## Recommendation
{finding.get('recommendation', 'Apply security best practices to remediate this finding.')}

## References
{self._format_references(finding.get('references', []))}

## Proof of Concept
{finding.get('poc', 'Consult with security team for exploitation scenarios.')}
"""
        
        return WikiPage(
            title=title,
            content=content,
            path=f"04-findings/finding-{index + 1:03d}.md"
        )
    
    def export_wiki(self, wiki: SecurityWiki, output_format: str = "markdown") -> str:
        """
        Export wiki to S3
        
        Args:
            wiki: SecurityWiki object to export
            output_format: Export format (markdown, json, html)
            
        Returns:
            S3 key of exported wiki
        """
        logger.info(f"Exporting wiki in {output_format} format...")
        
        if output_format == "markdown":
            return self._export_markdown(wiki)
        elif output_format == "json":
            return self._export_json(wiki)
        else:
            raise ValueError(f"Unsupported format: {output_format}")
    
    def _export_markdown(self, wiki: SecurityWiki) -> str:
        """Export wiki as markdown files to S3"""
        
        base_key = f"wikis/{self.mission_id}"
        
        # Export index
        index_content = self._generate_wiki_index(wiki)
        self._write_s3_file(f"{base_key}/README.md", index_content)
        
        # Export all pages
        for page in wiki.pages:
            self._export_page_recursive(page, base_key)
        
        logger.info(f"Wiki exported to s3://{self.s3_bucket}/{base_key}/")
        return base_key
    
    def _export_page_recursive(self, page: WikiPage, base_key: str):
        """Recursively export a page and its children"""
        
        # Export page content
        full_key = f"{base_key}/{page.path}"
        self._write_s3_file(full_key, page.content)
        
        # Export children
        for child in page.children:
            self._export_page_recursive(child, base_key)
    
    def _generate_wiki_index(self, wiki: SecurityWiki) -> str:
        """Generate wiki index/home page"""
        
        content = f"""# {wiki.title}

{wiki.summary}

## Security Posture: {wiki.security_posture.get('overall', 'UNKNOWN')}

{self._format_security_posture_badge(wiki.security_posture)}

## Contents

{self._generate_table_of_contents(wiki.pages)}

---

**Analysis ID**: `{wiki.mission_id}`  
**Generated**: {wiki.created_at}  
**Platform**: Hivemind-Prism
"""
        
        return content
    
    def _generate_table_of_contents(self, pages: List[WikiPage], level: int = 0) -> str:
        """Generate table of contents from pages"""
        
        toc = []
        for page in pages:
            indent = "  " * level
            toc.append(f"{indent}- [{page.title}]({page.path})")
            if page.children:
                toc.append(self._generate_table_of_contents(page.children, level + 1))
        
        return "\n".join(toc)
    
    # Helper methods
    
    def _load_s3_json(self, key: str) -> Dict[str, Any]:
        """Load JSON from S3"""
        try:
            response = self.s3.get_object(Bucket=self.s3_bucket, Key=key)
            return json.loads(response['Body'].read())
        except ClientError as e:
            logger.error(f"Error loading {key}: {e}")
            return {}
    
    def _write_s3_file(self, key: str, content: str):
        """Write file to S3"""
        try:
            self.s3.put_object(
                Bucket=self.s3_bucket,
                Key=key,
                Body=content.encode('utf-8'),
                ContentType='text/markdown'
            )
        except ClientError as e:
            logger.error(f"Error writing {key}: {e}")
    
    def _format_criticality(self, tier: int) -> str:
        """Format criticality tier"""
        tiers = {
            0: "🔴 Critical",
            1: "🟠 High",
            2: "🟡 Medium",
            3: "🟢 Low"
        }
        return tiers.get(tier, "❓ Unknown")
    
    def _generate_immediate_actions(self, findings: Dict[str, Any]) -> str:
        """Generate immediate action items"""
        critical = [f for f in findings.get('findings', []) if f.get('severity') == 'CRITICAL']
        
        if not critical:
            return "✅ No immediate critical actions required."
        
        actions = []
        for i, finding in enumerate(critical[:5], 1):
            actions.append(f"{i}. **{finding.get('title')}**: {finding.get('recommendation', 'Review and remediate')[:100]}...")
        
        return "\n".join(actions)
    
    def _calc_percentage(self, findings: List[Dict], severity: str) -> float:
        """Calculate percentage of findings with given severity"""
        if not findings:
            return 0.0
        count = sum(1 for f in findings if f.get('severity') == severity)
        return round(count / len(findings) * 100, 1)
    
    def _format_category_breakdown(self, by_category: Dict[str, List]) -> str:
        """Format category breakdown"""
        breakdown = []
        for category, findings in sorted(by_category.items(), key=lambda x: len(x[1]), reverse=True):
            breakdown.append(f"#### {category.title()}")
            breakdown.append(f"**Count**: {len(findings)}")
            breakdown.append(f"**Severity**: {self._get_highest_severity(findings)}")
            breakdown.append("")
        
        return "\n".join(breakdown)
    
    def _get_highest_severity(self, findings: List[Dict]) -> str:
        """Get highest severity from findings list"""
        severities = {'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1}
        max_sev = max((severities.get(f.get('severity', 'LOW'), 1) for f in findings), default=1)
        
        for sev, val in severities.items():
            if val == max_sev:
                return sev
        return 'LOW'
    
    def _identify_strengths(self, research: Dict, findings: Dict) -> str:
        """Identify security strengths"""
        strengths = []
        
        # Check for positive indicators
        if not any(f.get('category') == 'secret' for f in findings.get('findings', [])):
            strengths.append("- ✅ No hardcoded secrets detected")
        
        if not any(f.get('severity') == 'CRITICAL' for f in findings.get('findings', [])):
            strengths.append("- ✅ No critical vulnerabilities found")
        
        if len(strengths) == 0:
            strengths.append("- Areas for improvement identified in findings section")
        
        return "\n".join(strengths)
    
    def _identify_concerns(self, findings: Dict) -> str:
        """Identify areas of concern"""
        concerns = []
        
        critical_count = sum(1 for f in findings.get('findings', []) if f.get('severity') == 'CRITICAL')
        high_count = sum(1 for f in findings.get('findings', []) if f.get('severity') == 'HIGH')
        
        if critical_count > 0:
            concerns.append(f"- ⚠️ {critical_count} critical vulnerabilities require immediate attention")
        
        if high_count > 0:
            concerns.append(f"- ⚠️ {high_count} high-severity issues should be prioritized")
        
        if len(concerns) == 0:
            concerns.append("- No major concerns identified")
        
        return "\n".join(concerns)
    
    def _assess_compliance(self, findings: Dict, research: Dict) -> str:
        """Assess compliance considerations"""
        return """- Review findings against applicable compliance frameworks (PCI-DSS, HIPAA, SOC 2, etc.)
- Ensure data handling practices meet regulatory requirements
- Document security controls for audit purposes"""
    
    def _generate_dependency_mermaid(self, files: List[tuple], dep_insights: Dict) -> str:
        """Generate Mermaid diagram for dependencies"""
        if not files:
            return "    "
        
        lines = []
        for i, (file_path, count) in enumerate(files):
            safe_id = f"F{i}"
            filename = Path(file_path).name[:20]
            lines.append(f"    {safe_id}[\"{filename}<br/>{count} imports\"]")
        
        return "\n    ".join(lines)
    
    def _format_component_table(self, files: List[tuple], dep_insights: Dict) -> str:
        """Format component table"""
        rows = []
        for file_path, count in files[:5]:
            data = dep_insights.get(file_path, {})
            filename = Path(file_path).name
            funcs = len(data.get('functions', []))
            classes = len(data.get('classes', []))
            rows.append(f"| `{filename}` | {count} | {funcs} | {classes} |")
        
        return "\n".join(rows)
    
    def _format_entry_points(self, call_insights: Dict) -> str:
        """Format entry points"""
        entry_points = []
        
        for func_name, data in list(call_insights.items())[:5]:
            if not data.get('called_by'):
                entry_points.append(f"- `{func_name}` ({Path(data.get('file_path', '')).name})")
        
        if not entry_points:
            return "- No isolated entry points detected"
        
        return "\n".join(entry_points)
    
    def _format_data_flows(self, data_flows: List[Dict]) -> str:
        """Format data flows"""
        if not data_flows:
            return "No explicit data flows documented."
        
        flows = []
        for flow in data_flows[:5]:
            flows.append(f"- **{flow.get('type', 'data')}**: {flow.get('from', '?')} → {flow.get('to', '?')}")
        
        return "\n".join(flows)
    
    def _format_key_dependencies(self, file_catalog: Dict) -> str:
        """Format key dependencies"""
        # This would parse package.json, requirements.txt, etc.
        return "See Architecture Overview for dependency details."
    
    def _generate_language_pie(self, by_language: Dict) -> str:
        """Generate language pie chart for Mermaid"""
        pie_data = []
        for lang, files in sorted(by_language.items(), key=lambda x: len(x[1]), reverse=True):
            pie_data.append(f'    "{lang}" : {len(files)}')
        
        return "\n".join(pie_data)
    
    def _format_complex_files(self, file_catalog: Dict) -> str:
        """Format high complexity files"""
        complex_files = [(path, meta) for path, meta in file_catalog.items() if meta.get('complexity', 0) > 10]
        complex_files.sort(key=lambda x: x[1].get('complexity', 0), reverse=True)
        
        if not complex_files:
            return "✅ No files with excessive complexity detected."
        
        rows = []
        for file_path, meta in complex_files[:10]:
            rows.append(f"- `{Path(file_path).name}`: Complexity {meta.get('complexity', 0)}")
        
        return "\n".join(rows)
    
    def _generate_directory_tree(self, file_catalog: Dict) -> str:
        """Generate simple directory tree"""
        # Simplified tree generation
        dirs = set()
        for file_path in file_catalog.keys():
            parts = Path(file_path).parts
            for i in range(len(parts)):
                dirs.add("/".join(parts[:i+1]))
        
        tree_lines = []
        for d in sorted(list(dirs))[:20]:  # Limit to 20 entries
            depth = d.count('/')
            indent = "  " * depth
            name = Path(d).name or d
            tree_lines.append(f"{indent}├── {name}")
        
        return "\n".join(tree_lines)
    
    def _calc_avg_file_size(self, file_catalog: Dict) -> float:
        """Calculate average file size"""
        if not file_catalog:
            return 0.0
        
        total_lines = sum(meta.get('line_count', 0) for meta in file_catalog.values())
        return round(total_lines / len(file_catalog), 1)
    
    def _assess_file_size(self, file_catalog: Dict) -> str:
        """Assess file size"""
        avg = self._calc_avg_file_size(file_catalog)
        if avg > 500:
            return "⚠️ Consider refactoring large files"
        elif avg > 300:
            return "⚡ Moderate - monitor growth"
        else:
            return "✅ Good"
    
    def _assess_complexity(self, avg_complexity: float) -> str:
        """Assess complexity"""
        if avg_complexity > 15:
            return "⚠️ High - refactoring recommended"
        elif avg_complexity > 10:
            return "⚡ Moderate - watch carefully"
        else:
            return "✅ Good"
    
    def _format_language_details(self, by_language: Dict) -> str:
        """Format language-specific details"""
        details = []
        for lang, files in sorted(by_language.items(), key=lambda x: len(x[1]), reverse=True):
            details.append(f"### {lang.title()}")
            details.append(f"- **Files**: {len(files)}")
            details.append(f"- **Total Lines**: {sum(f.get('line_count', 0) for f in files):,}")
            details.append("")
        
        return "\n".join(details)
    
    def _format_findings_by_severity(self, findings: List[Dict], severity: str) -> str:
        """Format findings for a severity level"""
        if not findings:
            return f"✅ No {severity.lower()} severity findings.\n"
        
        formatted = []
        for i, finding in enumerate(findings, 1):
            formatted.append(f"### {i}. {finding.get('title', 'Untitled')}")
            formatted.append(f"**File**: `{finding.get('file', 'Multiple files')}`")
            formatted.append(f"**Category**: {finding.get('category', 'Other')}")
            formatted.append(f"\n{finding.get('description', 'No description')[:200]}...")
            formatted.append(f"\n**Recommendation**: {finding.get('recommendation', 'Review and remediate')[:150]}...\n")
        
        return "\n".join(formatted)
    
    def _generate_attack_scenarios(self, findings: List[Dict]) -> str:
        """Generate attack scenarios from findings"""
        scenarios = []
        
        # Group related findings into attack chains
        critical_high = [f for f in findings if f.get('severity') in ['CRITICAL', 'HIGH']]
        
        if critical_high:
            scenarios.append("### Potential Attack Chain")
            scenarios.append("1. Attacker identifies exposed vulnerability")
            scenarios.append("2. Exploits weakness to gain initial access")
            scenarios.append("3. Escalates privileges through discovered flaws")
            scenarios.append("4. Exfiltrates sensitive data or disrupts operations")
        else:
            scenarios.append("✅ No high-risk attack scenarios identified.")
        
        return "\n".join(scenarios)
    
    def _format_remediation_by_category(self, by_category: Dict) -> str:
        """Format remediation guidance by category"""
        remediation = []
        
        for category, findings in sorted(by_category.items(), key=lambda x: len(x[1]), reverse=True):
            remediation.append(f"### {category.title()}")
            remediation.append(f"**Findings**: {len(findings)}")
            remediation.append("\n**Recommended Actions**:")
            
            # Get unique recommendations
            recs = set()
            for f in findings[:3]:  # Top 3 per category
                rec = f.get('recommendation', '')
                if rec:
                    recs.add(rec)
            
            for rec in list(recs)[:3]:
                remediation.append(f"- {rec[:150]}...")
            
            remediation.append("")
        
        return "\n".join(remediation)
    
    def _identify_quick_wins(self, findings: List[Dict]) -> str:
        """Identify quick win improvements"""
        quick_wins = []
        
        # Look for easily fixable issues
        for finding in findings:
            if finding.get('severity') in ['MEDIUM', 'HIGH']:
                if 'hardcoded' in finding.get('description', '').lower():
                    quick_wins.append(f"- Remove hardcoded secrets in `{finding.get('file', 'unknown')}`")
        
        if not quick_wins:
            quick_wins.append("- Enable automated security scanning in CI/CD pipeline")
            quick_wins.append("- Implement pre-commit hooks for secret detection")
        
        return "\n".join(quick_wins[:5])
    
    def _identify_strategic_improvements(self, findings: List[Dict]) -> str:
        """Identify strategic improvements"""
        improvements = [
            "- Implement comprehensive security testing framework",
            "- Establish security champions program",
            "- Conduct regular security training for developers",
            "- Integrate threat modeling into design process",
            "- Implement security metrics and KPIs"
        ]
        
        return "\n".join(improvements)
    
    def _generate_file_index(self, file_catalog: Dict, patterns_by_file: Dict) -> str:
        """Generate file index"""
        index = []
        
        # Sort by security concern (files with patterns first)
        sorted_files = sorted(
            file_catalog.items(),
            key=lambda x: len(patterns_by_file.get(x[1].get('relative_path', ''), [])),
            reverse=True
        )
        
        for file_path, metadata in sorted_files[:20]:  # Top 20
            relative_path = metadata.get('relative_path', file_path)
            patterns = patterns_by_file.get(relative_path, [])
            icon = "⚠️" if patterns else "📄"
            
            index.append(f"- {icon} [`{Path(relative_path).name}`](#{self._slugify(relative_path)})")
        
        return "\n".join(index)
    
    def _generate_detailed_file_docs(self, file_catalog: Dict, patterns_by_file: Dict) -> str:
        """Generate detailed file documentation"""
        docs = []
        
        sorted_files = sorted(
            file_catalog.items(),
            key=lambda x: len(patterns_by_file.get(x[1].get('relative_path', ''), [])),
            reverse=True
        )
        
        for file_path, metadata in sorted_files[:10]:  # Detail top 10
            relative_path = metadata.get('relative_path', file_path)
            patterns = patterns_by_file.get(relative_path, [])
            
            docs.append(f"### {Path(relative_path).name}")
            docs.append(f"**Path**: `{relative_path}`")
            docs.append(f"**Language**: {metadata.get('language', 'unknown')}")
            docs.append(f"**Lines**: {metadata.get('line_count', 0)}")
            docs.append(f"**Complexity**: {metadata.get('complexity', 0)}")
            
            if metadata.get('functions'):
                docs.append(f"**Functions**: {', '.join(metadata['functions'][:5])}")
            
            if metadata.get('classes'):
                docs.append(f"**Classes**: {', '.join(metadata['classes'][:5])}")
            
            if patterns:
                docs.append(f"\n**⚠️ Security Concerns**: {len(patterns)} patterns detected")
                for pattern in patterns[:3]:
                    docs.append(f"- Line {pattern.get('line')}: {pattern.get('type')}")
            
            docs.append("\n---\n")
        
        return "\n".join(docs)
    
    def _slugify(self, text: str) -> str:
        """Convert text to slug"""
        return text.lower().replace('/', '-').replace('.', '-')
    
    def _format_references(self, references: List[str]) -> str:
        """Format references"""
        if not references:
            return "No external references provided."
        
        return "\n".join([f"- {ref}" for ref in references])
    
    def _calculate_security_posture(self, findings: Dict, context_manifest: Dict) -> Dict[str, Any]:
        """Calculate overall security posture"""
        findings_list = findings.get('findings', [])
        
        critical = sum(1 for f in findings_list if f.get('severity') == 'CRITICAL')
        high = sum(1 for f in findings_list if f.get('severity') == 'HIGH')
        
        # Simple scoring
        if critical > 0:
            overall = "CRITICAL"
        elif high > 3:
            overall = "HIGH"
        elif high > 0:
            overall = "MEDIUM"
        else:
            overall = "GOOD"
        
        return {
            'overall': overall,
            'critical_count': critical,
            'high_count': high,
            'total_findings': len(findings_list),
            'criticality_tier': context_manifest.get('criticality_tier', 2)
        }
    
    def _generate_wiki_summary(self, context_manifest: Dict, findings: Dict) -> str:
        """Generate wiki summary"""
        service_name = context_manifest.get('service_name', 'Unknown Service')
        total_findings = len(findings.get('findings', []))
        
        return f"""This comprehensive security analysis wiki documents the security posture of **{service_name}**.

The analysis identified **{total_findings} security findings** across multiple categories including code patterns, dependencies, and architectural concerns.

Navigate through the sections to explore detailed findings, remediation guidance, and architectural documentation."""
    
    def _format_security_posture_badge(self, posture: Dict[str, Any]) -> str:
        """Format security posture badge"""
        overall = posture.get('overall', 'UNKNOWN')
        critical = posture.get('critical_count', 0)
        high = posture.get('high_count', 0)
        
        badges = {
            'CRITICAL': '🔴',
            'HIGH': '🟠',
            'MEDIUM': '🟡',
            'GOOD': '🟢'
        }
        
        badge = badges.get(overall, '⚪')
        
        return f"""{badge} **{overall}** 
- Critical Issues: {critical}
- High Severity: {high}
- Total Findings: {posture.get('total_findings', 0)}"""
    
    def _export_json(self, wiki: SecurityWiki) -> str:
        """Export wiki as JSON"""
        base_key = f"wikis/{self.mission_id}/wiki.json"
        
        # Convert to dict
        wiki_dict = {
            'mission_id': wiki.mission_id,
            'title': wiki.title,
            'summary': wiki.summary,
            'security_posture': wiki.security_posture,
            'pages': self._pages_to_dict(wiki.pages),
            'created_at': wiki.created_at
        }
        
        self.s3.put_object(
            Bucket=self.s3_bucket,
            Key=base_key,
            Body=json.dumps(wiki_dict, indent=2).encode('utf-8'),
            ContentType='application/json'
        )
        
        return base_key
    
    def _pages_to_dict(self, pages: List[WikiPage]) -> List[Dict]:
        """Convert pages to dict recursively"""
        result = []
        for page in pages:
            result.append({
                'title': page.title,
                'content': page.content,
                'path': page.path,
                'children': self._pages_to_dict(page.children) if page.children else []
            })
        return result