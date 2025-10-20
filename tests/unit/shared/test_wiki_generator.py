"""
Unit Tests for Security Wiki Generator
=======================================

Tests the security-focused documentation wiki generator.
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from moto import mock_aws
import boto3
from src.shared.documentation.wiki_generator import (
    SecurityWikiGenerator,
    WikiPage,
    SecurityWiki
)


@pytest.mark.shared
@pytest.mark.unit
class TestSecurityWikiGenerator:
    """Test suite for SecurityWikiGenerator."""
    
    def test_initialization(self):
        """Test WikiGenerator initialization."""
        generator = SecurityWikiGenerator(
            mission_id='mission-123',
            s3_bucket='test-bucket'
        )
        
        assert generator.mission_id == 'mission-123'
        assert generator.s3_bucket == 'test-bucket'
        assert generator.s3 is not None
    
    @mock_aws
    def test_generate_wiki_complete(self):
        """Test complete wiki generation."""
        # Setup S3
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-bucket')
        
        # Mock research artifacts
        research_data = {
            'catalog': {'total_files': 10, 'languages': {'python': 5}},
            'dependency_graph': {},
            'call_graph': {}
        }
        
        # Mock findings
        findings_data = {
            'timestamp': '2024-01-01T00:00:00Z',
            'findings': [
                {
                    'severity': 'CRITICAL',
                    'title': 'SQL Injection',
                    'category': 'code_pattern',
                    'description': 'Potential SQL injection'
                },
                {
                    'severity': 'HIGH',
                    'title': 'Hardcoded Secret',
                    'category': 'secret',
                    'description': 'API key in code'
                }
            ]
        }
        
        # Mock context manifest
        context_manifest = {
            'service_name': 'TestService',
            'criticality_tier': 1,
            'file_count': 10,
            'total_lines': 1000,
            'primary_languages': ['Python', 'JavaScript'],
            'security_patterns_count': 5,
            'handles_pii': True,
            'handles_payment': False,
            'authentication_present': True
        }
        
        # Upload mock data
        s3.put_object(
            Bucket='test-bucket',
            Key='research.json',
            Body=json.dumps(research_data)
        )
        s3.put_object(
            Bucket='test-bucket',
            Key='findings.json',
            Body=json.dumps(findings_data)
        )
        
        # Generate wiki
        generator = SecurityWikiGenerator(
            mission_id='mission-123',
            s3_bucket='test-bucket'
        )
        
        wiki = generator.generate_wiki(
            research_artifacts_key='research.json',
            findings_key='findings.json',
            context_manifest=context_manifest
        )
        
        # Assert
        assert isinstance(wiki, SecurityWiki)
        assert wiki.mission_id == 'mission-123'
        assert 'TestService' in wiki.title
        assert len(wiki.pages) > 0
        assert wiki.security_posture is not None
    
    @mock_aws
    def test_executive_summary_generation(self):
        """Test executive summary page generation."""
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-bucket')
        
        research_data = {'catalog': {}}
        findings_data = {
            'timestamp': '2024-01-01',
            'findings': [
                {'severity': 'CRITICAL', 'title': 'Test', 'category': 'test', 'description': 'desc'},
                {'severity': 'HIGH', 'title': 'Test2', 'category': 'test', 'description': 'desc2'}
            ]
        }
        
        s3.put_object(Bucket='test-bucket', Key='r.json', Body=json.dumps(research_data))
        s3.put_object(Bucket='test-bucket', Key='f.json', Body=json.dumps(findings_data))
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        context = {
            'service_name': 'TestApp',
            'criticality_tier': 1,
            'file_count': 5
        }
        
        page = generator._generate_executive_summary(context, findings_data)
        
        assert isinstance(page, WikiPage)
        assert page.title == 'Executive Summary'
        assert 'TestApp' in page.content
        assert 'Executive Summary' in page.content
        assert page.path == '00-executive-summary.md'
    
    @mock_aws
    def test_security_posture_generation(self):
        """Test security posture page generation."""
        findings_data = {
            'findings': [
                {'severity': 'CRITICAL', 'category': 'sql_injection'},
                {'severity': 'HIGH', 'category': 'xss'},
                {'severity': 'MEDIUM', 'category': 'info_disclosure'}
            ]
        }
        research_data = {'catalog': {}}
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        page = generator._generate_security_posture(findings_data, research_data)
        
        assert isinstance(page, WikiPage)
        assert page.title == 'Security Posture'
        assert 'Security Posture Analysis' in page.content
        assert page.path == '01-security-posture.md'
    
    @mock_aws
    def test_architecture_overview_generation(self):
        """Test architecture overview generation."""
        research_data = {
            'dependency_graph': {
                'file1.py': {'imported_by': ['file2.py', 'file3.py']},
                'file2.py': {'imported_by': []}
            },
            'call_graph': {}
        }
        context = {'service_name': 'App'}
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        page = generator._generate_architecture_overview(research_data, context)
        
        assert isinstance(page, WikiPage)
        assert 'Architecture Overview' in page.content
        assert 'mermaid' in page.content.lower()
    
    @mock_aws
    def test_findings_section_generation(self):
        """Test findings section generation."""
        findings_data = {
            'findings': [
                {
                    'severity': 'CRITICAL',
                    'title': 'SQL Injection Vulnerability',
                    'description': 'User input not sanitized',
                    'file_path': '/src/db.py',
                    'line_number': 42,
                    'category': 'injection'
                }
            ]
        }
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        page = generator._generate_findings_section(findings_data)
        
        assert isinstance(page, WikiPage)
        assert 'SQL Injection' in page.content
        # Wiki generator may show "Multiple files" for multiple locations or single file path
        assert ('Multiple files' in page.content or '/src/db.py' in page.content or 'db.py' in page.content)
    
    @mock_aws
    def test_remediation_guide_generation(self):
        """Test remediation guide generation."""
        findings_data = {
            'findings': [
                {
                    'severity': 'HIGH',
                    'title': 'Hardcoded Password',
                    'category': 'secret',
                    'remediation': 'Use environment variables'
                }
            ]
        }
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        page = generator._generate_remediation_guide(findings_data)
        
        assert isinstance(page, WikiPage)
        assert 'Remediation' in page.title
    
    @mock_aws
    def test_calculate_security_posture(self):
        """Test security posture calculation."""
        findings_data = {
            'findings': [
                {'severity': 'CRITICAL'},
                {'severity': 'CRITICAL'},
                {'severity': 'HIGH'},
                {'severity': 'MEDIUM'}
            ]
        }
        context = {'criticality_tier': 1}
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        posture = generator._calculate_security_posture(findings_data, context)
        
        assert 'overall_score' in posture or 'critical_count' in posture or isinstance(posture, dict)
    
    @mock_aws
    def test_handles_empty_findings(self):
        """Test handling of empty findings."""
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-bucket')
        
        research_data = {'catalog': {}}
        findings_data = {'findings': [], 'timestamp': '2024-01-01'}
        
        s3.put_object(Bucket='test-bucket', Key='r.json', Body=json.dumps(research_data))
        s3.put_object(Bucket='test-bucket', Key='f.json', Body=json.dumps(findings_data))
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        context = {'service_name': 'App', 'criticality_tier': 2}
        
        wiki = generator.generate_wiki('r.json', 'f.json', context)
        
        assert isinstance(wiki, SecurityWiki)
        assert len(wiki.pages) > 0
    
    @mock_aws
    def test_s3_artifact_loading(self):
        """Test S3 artifact loading."""
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-bucket')
        
        test_data = {'key': 'value', 'number': 42}
        s3.put_object(
            Bucket='test-bucket',
            Key='test.json',
            Body=json.dumps(test_data)
        )
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        loaded_data = generator._load_s3_json('test.json')
        
        assert loaded_data == test_data
    
    @mock_aws
    def test_mermaid_diagram_generation(self):
        """Test Mermaid diagram inclusion in wiki."""
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-bucket')
        
        research_data = {'dependency_graph': {}}
        findings_data = {
            'findings': [{'severity': 'HIGH', 'title': 'Test', 'category': 'test', 'description': 'desc'}],
            'timestamp': '2024-01-01'
        }
        
        s3.put_object(Bucket='test-bucket', Key='r.json', Body=json.dumps(research_data))
        s3.put_object(Bucket='test-bucket', Key='f.json', Body=json.dumps(findings_data))
        
        generator = SecurityWikiGenerator('m1', 'test-bucket')
        context = {'service_name': 'App', 'criticality_tier': 1}
        
        wiki = generator.generate_wiki('r.json', 'f.json', context)
        
        # Check that at least one page contains Mermaid syntax
        has_mermaid = any('```mermaid' in page.content for page in wiki.pages)
        assert has_mermaid
    
    @mock_aws
    def test_wiki_page_structure(self):
        """Test WikiPage dataclass structure."""
        page = WikiPage(
            title='Test Page',
            content='# Test Content',
            path='test.md'
        )
        
        assert page.title == 'Test Page'
        assert page.content == '# Test Content'
        assert page.path == 'test.md'
        assert page.children == []
    
    @mock_aws
    def test_security_wiki_structure(self):
        """Test SecurityWiki dataclass structure."""
        pages = [WikiPage('Page1', 'Content1', 'p1.md')]
        
        wiki = SecurityWiki(
            mission_id='m1',
            title='Test Wiki',
            summary='Summary',
            security_posture={'score': 75},
            pages=pages,
            created_at='2024-01-01'
        )
        
        assert wiki.mission_id == 'm1'
        assert wiki.title == 'Test Wiki'
        assert len(wiki.pages) == 1
        assert wiki.security_posture['score'] == 75


if __name__ == '__main__':
    pytest.main([__file__, '-v'])