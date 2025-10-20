"""
Unit Tests for Memory Ingestor Lambda
======================================

Tests Kendra memory ingestion Lambda that creates searchable memory documents from findings.
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from moto import mock_aws


@pytest.mark.lambda_func
@pytest.mark.unit
class TestMemoryIngestorLambda:
    """Test suite for Memory Ingestor Lambda."""
    
    @mock_aws
    def test_handler_queries_dynamodb(self, mock_environment):
        """Test handler queries DynamoDB for findings."""
        import boto3
        from src.lambdas.memory_ingestor.index import handler
        
        # Create mock DynamoDB table
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-findings-table',
            KeySchema=[
                {'AttributeName': 'finding_id', 'KeyType': 'HASH'},
            ],
            AttributeDefinitions=[
                {'AttributeName': 'finding_id', 'AttributeType': 'S'},
                {'AttributeName': 'mission_id', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[{
                'IndexName': 'mission_id-timestamp-index',
                'KeySchema': [
                    {'AttributeName': 'mission_id', 'KeyType': 'HASH'},
                ],
                'Projection': {'ProjectionType': 'ALL'},
                'ProvisionedThroughput': {'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
            }],
            BillingMode='PROVISIONED',
            ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
        )
        
        # Create S3 bucket
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-kendra-bucket')
        
        # Act
        event = {'mission_id': 'test-mission-123'}
        
        with patch.dict('os.environ', {
            'FINDINGS_TABLE': 'test-findings-table',
            'KENDRA_BUCKET': 'test-kendra-bucket',
            'KENDRA_INDEX_ID': 'test-index-123'
        }):
            result = handler(event, {})
        
        # Assert
        assert result['status'] == 'success'
        assert 'documents_created' in result
    
    @mock_aws
    def test_handler_creates_memory_documents(self, mock_environment):
        """Test handler creates JSON documents in S3."""
        import boto3
        from src.lambdas.memory_ingestor import index as memory_module
        
        # Setup
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-findings-table',
            KeySchema=[{'AttributeName': 'finding_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[
                {'AttributeName': 'finding_id', 'AttributeType': 'S'},
                {'AttributeName': 'mission_id', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[{
                'IndexName': 'mission_id-timestamp-index',
                'KeySchema': [{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
                'Projection': {'ProjectionType': 'ALL'},
                'ProvisionedThroughput': {'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
            }],
            BillingMode='PROVISIONED',
            ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
        )
        
        # Add test finding
        dynamodb.put_item(
            TableName='test-findings-table',
            Item={
                'finding_id': {'S': 'finding-1'},
                'mission_id': {'S': 'test-mission'},
                'title': {'S': 'SQL Injection'},
                'description': {'S': 'Potential SQL injection vulnerability'},
                'severity': {'S': 'HIGH'},
                'repo_name': {'S': 'test-repo'},
                'file_path': {'S': '/src/db.py'},
                'tool_source': {'S': 'semgrep'},
                'evidence_digest': {'S': 'abc123'},
                'created_at': {'S': '2024-01-01T00:00:00Z'},
                'confidence_score': {'N': '0.95'}
            }
        )
        
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-kendra-bucket')
        
        # Act
        event = {'mission_id': 'test-mission'}
        
        # Patch module-level variables
        with patch.object(memory_module, 'FINDINGS_TABLE', 'test-findings-table'):
            with patch.object(memory_module, 'KENDRA_BUCKET', 'test-kendra-bucket'):
                with patch.object(memory_module, 'KENDRA_INDEX_ID', 'test-index-123'):
                    result = memory_module.handler(event, {})
        
        # Assert
        assert result['status'] == 'success'
        assert result['documents_created'] == 1
        
        # Verify S3 object created
        response = s3.list_objects_v2(Bucket='test-kendra-bucket', Prefix='findings/')
        assert response['KeyCount'] == 1
    
    def test_error_handling_missing_mission_id(self):
        """Test error handling when mission_id is missing."""
        from src.lambdas.memory_ingestor.index import handler
        
        event = {}
        
        with patch.dict('os.environ', {
            'FINDINGS_TABLE': 'test-table',
            'KENDRA_BUCKET': 'test-bucket',
            'KENDRA_INDEX_ID': 'test-index'
        }):
            result = handler(event, {})
        
        assert result['status'] == 'error'
        assert 'error' in result
    
    @mock_aws
    def test_document_structure(self):
        """Test created document has correct structure."""
        import boto3
        from src.lambdas.memory_ingestor.index import create_finding_document
        
        finding = {
            'finding_id': {'S': 'f1'},
            'title': {'S': 'Test Finding'},
            'description': {'S': 'Test description'},
            'severity': {'S': 'MEDIUM'},
            'repo_name': {'S': 'repo'},
            'file_path': {'S': '/test.py'},
            'tool_source': {'S': 'semgrep'},
            'evidence_digest': {'S': 'hash123'},
            'created_at': {'S': '2024-01-01T00:00:00Z'},
            'mission_id': {'S': 'mission1'},
            'confidence_score': {'N': '0.8'}
        }
        
        doc = create_finding_document(finding)
        
        assert doc['finding_id'] == 'f1'
        assert doc['title'] == 'Test Finding'
        assert doc['severity'] == 'MEDIUM'
        assert doc['confidence_score'] == 0.8
        assert doc['_category'] == 'security_finding'
        assert '_searchable_text' in doc
    
    @mock_aws
    def test_handles_multiple_findings(self):
        """Test processing multiple findings."""
        import boto3
        from src.lambdas.memory_ingestor import index as memory_module
        
        # Setup DynamoDB and S3
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-findings-table',
            KeySchema=[{'AttributeName': 'finding_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[
                {'AttributeName': 'finding_id', 'AttributeType': 'S'},
                {'AttributeName': 'mission_id', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[{
                'IndexName': 'mission_id-timestamp-index',
                'KeySchema': [{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
                'Projection': {'ProjectionType': 'ALL'},
                'ProvisionedThroughput': {'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
            }],
            BillingMode='PROVISIONED',
            ProvisionedThroughput={'ReadCapacityUnits': 5, 'WriteCapacityUnits': 5}
        )
        
        # Add multiple findings
        for i in range(3):
            dynamodb.put_item(
                TableName='test-findings-table',
                Item={
                    'finding_id': {'S': f'finding-{i}'},
                    'mission_id': {'S': 'mission-multi'},
                    'title': {'S': f'Finding {i}'},
                    'description': {'S': 'Description'},
                    'severity': {'S': 'HIGH'},
                    'repo_name': {'S': 'repo'},
                    'file_path': {'S': f'/file{i}.py'},
                    'tool_source': {'S': 'tool'},
                    'evidence_digest': {'S': f'hash{i}'},
                    'created_at': {'S': '2024-01-01T00:00:00Z'},
                    'confidence_score': {'N': '0.9'}
                }
            )
        
        s3 = boto3.client('s3', region_name='us-east-1')
        s3.create_bucket(Bucket='test-kendra-bucket')
        
        # Act
        event = {'mission_id': 'mission-multi'}
        
        # Patch module-level variables
        with patch.object(memory_module, 'FINDINGS_TABLE', 'test-findings-table'):
            with patch.object(memory_module, 'KENDRA_BUCKET', 'test-kendra-bucket'):
                with patch.object(memory_module, 'KENDRA_INDEX_ID', 'test-index'):
                    result = memory_module.handler(event, {})
        
        # Assert
        assert result['status'] == 'success'
        assert result['documents_created'] == 3


if __name__ == '__main__':
    pytest.main([__file__, '-v'])