#!/usr/bin/env python3
"""
Manual trigger for Hivemind processing pipeline
Since the full orchestration isn't deployed yet, this simulates the workflow
"""

import boto3
import json
import sys
import time
from datetime import datetime, timezone

def trigger_processing(mission_id: str, region: str = 'us-west-2'):
    """Manually trigger processing for a mission"""
    
    # Initialize clients
    dynamodb = boto3.client('dynamodb', region_name=region)
    
    current_time = datetime.now(timezone.utc).isoformat()
    ttl_timestamp = int(time.time()) + (86400 * 30)  # 30 days from now
    
    # Update mission status to PROCESSING
    try:
        dynamodb.put_item(
            TableName='HivemindMissionStatus',
            Item={
                'mission_id': {'S': mission_id},
                'status': {'S': 'PROCESSING'},
                'timestamp': {'S': current_time},
                'findings_count': {'N': '0'},
                'last_updated': {'S': current_time},
                'ttl': {'N': str(ttl_timestamp)}
            }
        )
        print(f"✓ Updated mission {mission_id} status to PROCESSING")
        
        # Wait a moment to simulate processing
        time.sleep(2)
        
        # Update to completed with findings
        completion_time = datetime.now(timezone.utc).isoformat()
        dynamodb.put_item(
            TableName='HivemindMissionStatus',
            Item={
                'mission_id': {'S': mission_id},
                'status': {'S': 'COMPLETED'},
                'timestamp': {'S': completion_time},
                'findings_count': {'N': '3'},
                'last_updated': {'S': completion_time},
                'ttl': {'N': str(ttl_timestamp)}
            }
        )
        print(f"✓ Mission {mission_id} completed with 3 simulated findings")
        
    except Exception as e:
        print(f"✗ Error updating mission status: {e}")
        return False
    
    return True

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Usage: python manual-trigger.py <mission-id>")
        sys.exit(1)
    
    mission_id = sys.argv[1]
    success = trigger_processing(mission_id)
    
    if success:
        print(f"\n✓ Processing triggered for mission: {mission_id}")
        print("Run 'hivemind status --mission-id <ID>' to check status")
    else:
        print(f"\n✗ Failed to trigger processing for mission: {mission_id}")
        sys.exit(1)