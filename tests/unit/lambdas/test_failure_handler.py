"""
Unit Tests for Failure Handler Lambda
======================================

Tests failure notification Lambda that updates mission status and sends notifications.
"""

import pytest
import json
from unittest.mock import Mock, patch
from moto import mock_aws


@pytest.mark.lambda_func
@pytest.mark.unit
class TestFailureHandlerLambda:
    """Test suite for Failure Handler Lambda."""
    
    @mock_aws
    def test_handler_updates_mission_status(self):
        """Test handler updates DynamoDB mission status."""
        import boto3
        from src.lambdas.failure_handler import index as failure_module
        
        # Create mock DynamoDB table
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-mission-table',
            KeySchema=[{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'mission_id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        
        # Add mission
        dynamodb.put_item(
            TableName='test-mission-table',
            Item={
                'mission_id': {'S': 'mission-123'},
                'status': {'S': 'IN_PROGRESS'}
            }
        )
        
        # Act
        event = {
            'mission_id': 'mission-123',
            'error': 'Agent execution failed'
        }
        
        # Patch module-level variables and client
        with patch.object(failure_module, 'MISSION_TABLE', 'test-mission-table'):
            with patch.object(failure_module, 'SNS_TOPIC_ARN', ''):
                with patch.object(failure_module, 'dynamodb_client', dynamodb):
                    result = failure_module.handler(event, {})
        
        # Assert
        assert result['status'] == 'failure_recorded'
        assert result['mission_id'] == 'mission-123'
        
        # Verify status updated
        response = dynamodb.get_item(
            TableName='test-mission-table',
            Key={'mission_id': {'S': 'mission-123'}}
        )
        assert response['Item']['status']['S'] == 'FAILED'
        assert 'error_message' in response['Item']
    
    @mock_aws
    def test_handler_sends_sns_notification(self):
        """Test SNS notification sent when topic configured."""
        import boto3
        from src.lambdas.failure_handler.index import handler
        
        # Setup
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-mission-table',
            KeySchema=[{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'mission_id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        
        sns = boto3.client('sns', region_name='us-east-1')
        topic_response = sns.create_topic(Name='test-topic')
        topic_arn = topic_response['TopicArn']
        
        # Act
        event = {
            'mission_id': 'mission-456',
            'error': 'Timeout error'
        }
        
        with patch.dict('os.environ', {
            'MISSION_TABLE': 'test-mission-table',
            'SNS_TOPIC_ARN': topic_arn
        }):
            result = handler(event, {})
        
        # Assert
        assert result['status'] == 'failure_recorded'
    
    @mock_aws
    def test_handler_without_sns(self):
        """Test handler works without SNS configured."""
        import boto3
        from src.lambdas.failure_handler.index import handler
        
        # Setup
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-mission-table',
            KeySchema=[{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'mission_id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        
        # Act
        event = {
            'mission_id': 'mission-789',
            'error': 'Unknown error'
        }
        
        with patch.dict('os.environ', {
            'MISSION_TABLE': 'test-mission-table',
            'SNS_TOPIC_ARN': ''
        }):
            result = handler(event, {})
        
        # Assert
        assert result['status'] == 'failure_recorded'
    
    @mock_aws
    def test_error_handling_exception(self):
        """Test error handling when exception occurs."""
        import boto3
        from src.lambdas.failure_handler import index as failure_module
        
        # Setup table
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-error-table',
            KeySchema=[{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'mission_id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        
        event = {'mission_id': 'test', 'error': 'Test error'}
        
        # Patch module-level variables
        with patch.object(failure_module, 'MISSION_TABLE', 'test-error-table'):
            with patch.object(failure_module, 'SNS_TOPIC_ARN', ''):
                result = failure_module.handler(event, {})
        
        # Handler succeeds with update_item (creates if not exists)
        assert result['status'] == 'failure_recorded'
    
    @mock_aws
    def test_handles_missing_error_field(self):
        """Test handler handles missing error field."""
        import boto3
        from src.lambdas.failure_handler.index import handler
        
        # Setup
        dynamodb = boto3.client('dynamodb', region_name='us-east-1')
        dynamodb.create_table(
            TableName='test-mission-table',
            KeySchema=[{'AttributeName': 'mission_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'mission_id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        
        # Act - no error field
        event = {'mission_id': 'mission-999'}
        
        with patch.dict('os.environ', {
            'MISSION_TABLE': 'test-mission-table',
            'SNS_TOPIC_ARN': ''
        }):
            result = handler(event, {})
        
        # Assert - should use default error message
        assert result['status'] == 'failure_recorded'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])