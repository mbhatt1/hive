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

try:
    AWS_REGION = os.environ['AWS_REGION']
    FINDINGS_TABLE = os.environ['FINDINGS_TABLE']
    KENDRA_BUCKET = os.environ['KENDRA_BUCKET']
    KENDRA_INDEX_ID = os.environ['KENDRA_INDEX_ID']
except KeyError as e:
    logger.error(f"Missing required environment variable: {e}")
    raise RuntimeError(f"Configuration error: Missing environment variable {e}")

dynamodb_client = boto3.client('dynamodb', region_name=AWS_REGION)
s3_client = boto3.client('s3', region_name=AWS_REGION)
kendra_client = boto3.client('kendra', region_name=AWS_REGION)

def handler(event, context):
    """
    Create Kendra memory documents from findings.
    
    Input: {mission_id}
    """
    try:
        mission_id = event['mission_id']
        logger.info(f"Creating memories for mission: {mission_id}")
        
        # Query findings for this mission
        try:
            response = dynamodb_client.query(
                TableName=FINDINGS_TABLE,
                IndexName='mission_id-timestamp-index',
                KeyConditionExpression='mission_id = :mid',
                ExpressionAttributeValues={':mid': {'S': mission_id}}
            )
        except Exception as e:
            logger.error(f"Failed to query findings from DynamoDB: {e}")
            raise
        
        findings = response.get('Items', [])
        logger.info(f"Found {len(findings)} findings to process")
        
        # Create memory documents
        documents_created = 0
        
        for finding in findings:
            try:
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
            except Exception as e:
                logger.error(f"Failed to create memory document for finding {finding.get('finding_id', {}).get('S', 'unknown')}: {e}")
                # Continue with other findings
        
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
    # Safely extract DynamoDB attributes with validation
    finding_id = finding.get('finding_id', {}).get('S', 'unknown')
    title = finding.get('title', {}).get('S', 'Unknown')
    description = finding.get('description', {}).get('S', 'No description')
    severity = finding.get('severity', {}).get('S', 'MEDIUM')
    repo_name = finding.get('repo_name', {}).get('S', 'unknown')
    file_path = finding.get('file_path', {}).get('S', 'unknown')
    tool_source = finding.get('tool_source', {}).get('S', 'unknown')
    evidence_digest = finding.get('evidence_digest', {}).get('S', 'unknown')
    created_at = finding.get('created_at', {}).get('S', '')
    mission_id = finding.get('mission_id', {}).get('S', 'unknown')
    confidence_score = float(finding.get('confidence_score', {}).get('N', '0.0'))
    
    return {
        'finding_id': finding_id,
        'title': title,
        'description': description,
        'severity': severity,
        'repo_name': repo_name,
        'file_path': file_path,
        'tool_source': tool_source,
        'evidence_digest': evidence_digest,
        'created_at': created_at,
        'mission_id': mission_id,
        'confidence_score': confidence_score,
        '_category': 'security_finding',
        '_searchable_text': f"{title} {description} {file_path}"
    }