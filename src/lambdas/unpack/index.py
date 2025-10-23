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

# Configure boto3 clients with retries and timeouts
boto_config = Config(
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    connect_timeout=10,
    read_timeout=60
)

s3_client = boto3.client('s3', config=boto_config)
dynamodb_client = boto3.client('dynamodb', config=boto_config)

try:
    UPLOADS_BUCKET = os.environ['UPLOADS_BUCKET']
    ARTIFACTS_BUCKET = os.environ['ARTIFACTS_BUCKET']
    MISSION_TABLE = os.environ['MISSION_TABLE']
except KeyError as e:
    logger.error(f"Missing required environment variable: {e}")
    raise RuntimeError(f"Configuration error: Missing environment variable {e}")

def handler(event, context):
    """
    Unpack and validate uploaded code archive.
    
    Input: S3 EventBridge event
    Output: {mission_id, status, unzipped_path}
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    # Extract mission_id from S3 key - handle both EventBridge and direct S3 events
    if 'detail' in event:
        # EventBridge S3 event
        s3_key = event['detail']['object']['key']
    elif 'Records' in event:
        # Direct S3 event
        s3_key = event['Records'][0]['s3']['object']['key']
    else:
        raise ValueError(f"Unknown event structure: {event}")
    
    # Extract mission_id with validation - expects: uploads/{mission_id}/source.tar.gz
    key_parts = s3_key.split('/')
    if len(key_parts) < 2:
        raise ValueError(f"Invalid S3 key format: {s3_key}. Expected: uploads/{{mission_id}}/source.tar.gz")
    mission_id = key_parts[1]
    
    try:
        
        logger.info(f"Processing mission: {mission_id}")
        
        # Read metadata to get repo_name and scan_type
        metadata_key = f"uploads/{mission_id}/metadata.json"
        try:
            metadata_obj = s3_client.get_object(Bucket=UPLOADS_BUCKET, Key=metadata_key)
            metadata = json.loads(metadata_obj['Body'].read())
            repo_name = metadata.get('repo_name', 'unknown')
            scan_type = metadata.get('scan_type', 'code')  # Default to 'code' if not specified
        except Exception as e:
            logger.warning(f"Could not read metadata: {e}")
            repo_name = 'unknown'
            scan_type = 'code'
        
        # Update mission status
        update_status(mission_id, 'UNPACKING')
        
        # Check file size before downloading
        head_response = s3_client.head_object(Bucket=UPLOADS_BUCKET, Key=s3_key)
        file_size = head_response['ContentLength']
        max_size = 5 * 1024 * 1024 * 1024  # 5GB limit
        
        if file_size > max_size:
            raise ValueError(f"Archive too large: {file_size} bytes (max {max_size})")
        
        # Download archive
        local_archive = f"/tmp/{mission_id}.tar.gz"
        logger.info(f"Downloading from s3://{UPLOADS_BUCKET}/{s3_key} ({file_size} bytes)")
        
        s3_client.download_file(UPLOADS_BUCKET, s3_key, local_archive)
        logger.info(f"Downloaded {file_size} bytes")
        
        # Verify checksum
        computed_sha256 = compute_sha256(local_archive)
        logger.info(f"Archive SHA256: {computed_sha256}")
        
        # Extract archive
        extract_dir = f"/tmp/{mission_id}"
        os.makedirs(extract_dir, exist_ok=True)
        
        with tarfile.open(local_archive, 'r:*') as tar:
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
            'scan_type': scan_type,
            'repo_name': repo_name,
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
    
    item = {
        'mission_id': {'S': mission_id},
        'status': {'S': status},
        'last_updated': {'S': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())},
        'findings_count': {'N': '0'}
    }
    
    if error:
        item['error_message'] = {'S': error}
    
    try:
        dynamodb_client.put_item(
            TableName=MISSION_TABLE,
            Item=item
        )
    except Exception as e:
        logger.error(f"Failed to update mission status in DynamoDB: {e}")
        # Don't re-raise - status update failure shouldn't block workflow