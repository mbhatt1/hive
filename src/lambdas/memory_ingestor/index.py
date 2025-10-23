"""
Memory Ingestor Lambda - Create Kendra Documents
Creates searchable memory documents from findings for institutional learning.
"""

import json
import boto3
import os
import logging
import time

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb_client = boto3.client('dynamodb', region_name=os.environ['AWS_REGION'])
s3_client = boto3.client('s3', region_name=os.environ['AWS_REGION'])
kendra_client = boto3.client('kendra', region_name=os.environ['AWS_REGION'])

FINDINGS_TABLE = os.environ['FINDINGS_TABLE']
KENDRA_BUCKET = os.environ['KENDRA_BUCKET']
KENDRA_INDEX_ID = os.environ['KENDRA_INDEX_ID']

def handler(event, context):
    """
    Create Kendra memory documents from findings.
    
    Input: {mission_id}
    """
    try:
        mission_id = event['mission_id']
        logger.info(f"Creating memories for mission: {mission_id}")
        
        # Query findings for this mission
        response = dynamodb_client.query(
            TableName=FINDINGS_TABLE,
            IndexName='mission_id-timestamp-index',
            KeyConditionExpression='mission_id = :mid',
            ExpressionAttributeValues={':mid': {'S': mission_id}}
        )
        
        findings = response.get('Items', [])
        logger.info(f"Found {len(findings)} findings to process")
        
        # Create memory documents
        documents_created = 0
        
        for finding in findings:
            # Create finding memory document
            doc = create_finding_document(finding)
            doc_key = f"findings/{finding['finding_id']['S']}.json"
            
            s3_client.put_object(
                Bucket=KENDRA_BUCKET,
                Key=doc_key,
                Body=json.dumps(doc, indent=2),
                ContentType='application/json',
                Metadata={
                    '_severity': finding['severity']['S'],
                    '_repo_name': finding['repo_name']['S'],
                    '_timestamp': finding['created_at']['S']
                }
            )
            
            documents_created += 1
        
        logger.info(f"Created {documents_created} memory documents")
        
        # Trigger Kendra sync (data source will pick up on schedule)
        
        return {
            'status': 'success',
            'documents_created': documents_created
        }
        
    except Exception as e:
        logger.error(f"Memory ingestor failed: {str(e)}", exc_info=True)
        return {
            'status': 'error',
            'error': str(e)
        }

def create_finding_document(finding):
    """Create structured document for Kendra indexing."""
    return {
        'finding_id': finding['finding_id']['S'],
        'title': finding['title']['S'],
        'description': finding['description']['S'],
        'severity': finding['severity']['S'],
        'repo_name': finding['repo_name']['S'],
        'file_path': finding['file_path']['S'],
        'tool_source': finding['tool_source']['S'],
        'evidence_digest': finding['evidence_digest']['S'],
        'created_at': finding['created_at']['S'],
        'mission_id': finding['mission_id']['S'],
        'confidence_score': float(finding['confidence_score']['N']),
        '_category': 'security_finding',
        '_searchable_text': f"{finding['title']['S']} {finding['description']['S']} {finding['file_path']['S']}"
    }