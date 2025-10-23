"""
Failure Handler Lambda - Handle Mission Failures
Updates status and sends notifications when missions fail.
"""

import json
import boto3
import os
import logging
import time

logger = logging.getLogger()
logger.setLevel(logging.INFO)

try:
    AWS_REGION = os.environ['AWS_REGION']
    MISSION_TABLE = os.environ['MISSION_TABLE']
except KeyError as e:
    logger.error(f"Missing required environment variable: {e}")
    raise RuntimeError(f"Configuration error: Missing environment variable {e}")

dynamodb_client = boto3.client('dynamodb', region_name=AWS_REGION)
sns_client = boto3.client('sns', region_name=AWS_REGION)

SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', '')  # Optional - may not be set

def handler(event, context):
    """
    Handle mission failure.
    
    Input: {mission_id, error}
    """
    try:
        mission_id = event.get('mission_id', 'unknown')
        error = event.get('error', 'Unknown error')
        
        logger.error(f"Mission {mission_id} failed: {error}")
        
        # Update mission status
        dynamodb_client.update_item(
            TableName=MISSION_TABLE,
            Key={'mission_id': {'S': mission_id}},
            UpdateExpression='SET #status = :status, error_message = :error, last_updated = :updated',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': {'S': 'FAILED'},
                ':error': {'S': error},
                ':updated': {'S': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            }
        )
        
        # Send SNS notification if configured
        if SNS_TOPIC_ARN:
            sns_client.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject=f'Hivemind Mission Failed: {mission_id}',
                Message=json.dumps({
                    'mission_id': mission_id,
                    'status': 'FAILED',
                    'error': error,
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
                }, indent=2)
            )
        
        return {
            'status': 'failure_recorded',
            'mission_id': mission_id
        }
        
    except Exception as e:
        logger.error(f"Failure handler error: {str(e)}", exc_info=True)
        return {
            'status': 'error',
            'error': str(e)
        }