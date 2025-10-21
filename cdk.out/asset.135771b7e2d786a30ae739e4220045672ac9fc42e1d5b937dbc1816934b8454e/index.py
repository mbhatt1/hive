"""
Unpack Lambda - Extract and Validate Uploaded Code
First step in the Step Functions workflow.
"""

import json
import boto3
import tarfile
import hashlib
import os
import logging
from pathlib import Path

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
dynamodb_client = boto3.client('dynamodb')

UPLOADS_BUCKET = os.environ.get('UPLOADS_BUCKET', 'hivemind-uploads')
ARTIFACTS_BUCKET = os.environ.get('ARTIFACTS_BUCKET', 'hivemind-artifacts')
MISSION_TABLE = os.environ.get('MISSION_TABLE', 'HivemindMissions')

def handler(event, context):
    """
    Unpack and validate uploaded code archive.
    
    Input: S3 EventBridge event
    Output: {mission_id, status, unzipped_path}
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    # Extract mission_id from S3 key
    s3_key = event['detail']['object']['key']
    mission_id = s3_key.split('/')[1]  # uploads/{mission_id}/source.tar.gz
    
    try:
        
        logger.info(f"Processing mission: {mission_id}")
        
        # Update mission status
        update_status(mission_id, 'UNPACKING')
        
        # Download archive
        local_archive = f"/tmp/{mission_id}.tar.gz"
        logger.info(f"Downloading from s3://{UPLOADS_BUCKET}/{s3_key}")
        
        try:
            s3_client.download_file(UPLOADS_BUCKET, s3_key, local_archive)
            file_size = os.path.getsize(local_archive)
            logger.info(f"Downloaded {file_size} bytes")
            
            # Check if file is actually gzip
            with open(local_archive, 'rb') as f:
                magic = f.read(2)
                if magic != b'\x1f\x8b':
                    logger.error(f"File is not gzip! Magic bytes: {magic.hex()}")
                    # Log first 200 bytes to see what we got
                    f.seek(0)
                    logger.error(f"First 200 bytes: {f.read(200)}")
                    raise ValueError("Downloaded file is not a valid gzip archive")
        except Exception as e:
            logger.error(f"Download failed: {str(e)}")
            raise
        
        # Verify checksum
        computed_sha256 = compute_sha256(local_archive)
        logger.info(f"Archive SHA256: {computed_sha256}")
        
        # Extract archive
        extract_dir = f"/tmp/{mission_id}"
        os.makedirs(extract_dir, exist_ok=True)
        
        with tarfile.open(local_archive, 'r:gz') as tar:
            # Security: Check for path traversal
            for member in tar.getmembers():
                if member.name.startswith('/') or '..' in member.name:
                    raise ValueError(f"Unsafe path in archive: {member.name}")
            tar.extractall(extract_dir)
        
        # Upload extracted files to artifacts bucket
        upload_count = upload_extracted_files(extract_dir, mission_id)
        
        # Update status
        update_status(mission_id, 'ANALYZING')
        
        logger.info(f"Unpacked {upload_count} files for mission {mission_id}")
        
        return {
            'mission_id': mission_id,
            'status': 'success',
            'unzipped_path': f"unzipped/{mission_id}/",
            'file_count': upload_count,
            'sha256': computed_sha256
        }
        
    except Exception as e:
        logger.error(f"Unpack failed: {str(e)}", exc_info=True)
        update_status(mission_id, 'FAILED', str(e))
        raise

def compute_sha256(file_path):
    """Compute SHA256 checksum of file."""
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b""):
            sha256.update(chunk)
    return sha256.hexdigest()

def upload_extracted_files(extract_dir, mission_id):
    """Upload extracted files to S3."""
    count = 0
    for root, dirs, files in os.walk(extract_dir):
        for file in files:
            local_path = Path(root) / file
            relative_path = local_path.relative_to(extract_dir)
            s3_key = f"unzipped/{mission_id}/{relative_path}"
            
            s3_client.upload_file(
                str(local_path),
                ARTIFACTS_BUCKET,
                s3_key
            )
            count += 1
    
    return count

def update_status(mission_id, status, error=None):
    """Update mission status in DynamoDB."""
    import time
    
    update_expr = 'SET #status = :status, last_updated = :updated'
    expr_values = {
        ':status': {'S': status},
        ':updated': {'S': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    }
    
    if error:
        update_expr += ', error_message = :error'
        expr_values[':error'] = {'S': error}
    
    dynamodb_client.update_item(
        TableName=MISSION_TABLE,
        Key={'mission_id': {'S': mission_id}},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues=expr_values
    )