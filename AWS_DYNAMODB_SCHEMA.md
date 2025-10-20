# AWS Findings DynamoDB Schema

This document describes how AWS security findings from ScoutSuite and Pacu MCP servers are stored in Hivemind-Prism's DynamoDB tables.

## Overview

AWS findings reuse the existing DynamoDB tables (`HivemindFindings`, `HivemindFindingsArchive`, `HivemindMissions`) with additional attributes specific to AWS infrastructure scans. This maintains consistency with code security findings while providing AWS-specific context.

## Table: HivemindFindings

Active findings from current scans.

### Schema Extensions for AWS

#### Partition Key
- `mission_id` (String): Unique identifier for the scan mission

#### Sort Key  
- `finding_id` (String): Unique finding identifier (format: `{tool}-{timestamp}-{hash}`)

#### Common Attributes (All Findings)
- `scan_type` (String): **NEW** - Values: `"code"` | `"container"` | `"aws"`
- `tool_name` (String): Name of the MCP tool (e.g., `"scoutsuite-mcp"`, `"pacu-mcp"`)
- `severity` (String): `"CRITICAL"` | `"HIGH"` | `"MEDIUM"` | `"LOW"` | `"INFO"`
- `title` (String): Finding title/summary
- `description` (String): Detailed description
- `status` (String): `"open"` | `"in_progress"` | `"resolved"` | `"false_positive"`
- `created_at` (String): ISO 8601 timestamp
- `updated_at` (String): ISO 8601 timestamp
- `metadata` (Map): Additional context (JSON)

#### AWS-Specific Attributes

When `scan_type == "aws"`, the following attributes are populated:

##### AWS Resource Information
- `aws_account_id` (String): AWS account ID where resource exists
- `aws_region` (String): AWS region (e.g., `"us-east-1"`)
- `aws_service` (String): AWS service name (e.g., `"IAM"`, `"S3"`, `"EC2"`, `"Lambda"`, `"RDS"`)
- `resource_type` (String): Resource type (e.g., `"iam_user"`, `"s3_bucket"`, `"ec2_instance"`)
- `resource_id` (String): Resource identifier (ARN, ID, or name)
- `resource_name` (String): Human-readable resource name

##### Finding Classification
- `finding_type` (String): Type of finding
  - ScoutSuite: `"misconfiguration"`, `"exposure"`, `"compliance_violation"`
  - Pacu: `"exploitable"`, `"privilege_escalation"`, `"data_access"`
- `compliance_frameworks` (StringSet): Applicable frameworks (e.g., `["CIS", "PCI-DSS", "SOC2"]`)
- `cwe_ids` (StringSet): CWE IDs if applicable
- `cve_ids` (StringSet): CVE IDs if applicable

##### Risk Assessment
- `risk_score` (Number): Calculated risk score (0-100)
- `exploitability` (String): **NEW** - From Pacu validation
  - `"confirmed"`: Successfully exploited in testing
  - `"probable"`: Conditions indicate exploitability
  - `"unlikely"`: Difficult to exploit
  - `"not_tested"`: Not validated by Pacu
- `blast_radius` (String): Potential impact scope
  - `"account"`: Affects entire AWS account
  - `"service"`: Limited to one service
  - `"resource"`: Single resource impact

##### Remediation
- `remediation_steps` (List): Step-by-step remediation guidance
- `automated_fix_available` (Boolean): Can be auto-remediated
- `terraform_fix` (String): Terraform code for fix (if available)
- `cloudformation_fix` (String): CloudFormation code for fix (if available)

##### Pacu Validation Results (if tested)
- `pacu_module_used` (String): Pacu module that validated the finding
- `pacu_test_result` (Map): Detailed test results
  ```json
  {
    "success": true,
    "privileges_gained": ["s3:GetObject", "s3:ListBucket"],
    "data_accessed": ["s3://sensitive-bucket/secrets.json"],
    "execution_time_seconds": 12.5,
    "notes": "Successfully accessed sensitive data"
  }
  ```

### Example: ScoutSuite Finding

```json
{
  "mission_id": "aws-scan-2024-01-15-12345",
  "finding_id": "scoutsuite-1705320000-a1b2c3d4",
  "scan_type": "aws",
  "tool_name": "scoutsuite-mcp",
  "severity": "HIGH",
  "title": "S3 Bucket with Public Read Access",
  "description": "Bucket 'company-backups' allows public read access, potentially exposing sensitive data",
  
  "aws_account_id": "123456789012",
  "aws_region": "us-east-1",
  "aws_service": "S3",
  "resource_type": "s3_bucket",
  "resource_id": "arn:aws:s3:::company-backups",
  "resource_name": "company-backups",
  
  "finding_type": "exposure",
  "compliance_frameworks": ["CIS", "PCI-DSS"],
  "risk_score": 85,
  "exploitability": "not_tested",
  "blast_radius": "resource",
  
  "remediation_steps": [
    "Remove public access block exemption",
    "Update bucket policy to remove 'Principal: *'",
    "Enable bucket encryption",
    "Review access logs for unauthorized access"
  ],
  "automated_fix_available": true,
  "terraform_fix": "resource \"aws_s3_bucket_public_access_block\" \"example\" {...}",
  
  "status": "open",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "metadata": {
    "scoutsuite_check_id": "s3-bucket-public-read",
    "flagged": true,
    "checked": 47,
    "max_level": "danger"
  }
}
```

### Example: Pacu Validation Finding

```json
{
  "mission_id": "aws-scan-2024-01-15-12345",
  "finding_id": "pacu-1705320120-e5f6g7h8",
  "scan_type": "aws",
  "tool_name": "pacu-mcp",
  "severity": "CRITICAL",
  "title": "Confirmed IAM Privilege Escalation Path",
  "description": "User 'dev-user' can escalate to admin via PassRole + Lambda execution",
  
  "aws_account_id": "123456789012",
  "aws_region": "us-east-1",
  "aws_service": "IAM",
  "resource_type": "iam_user",
  "resource_id": "arn:aws:iam::123456789012:user/dev-user",
  "resource_name": "dev-user",
  
  "finding_type": "privilege_escalation",
  "compliance_frameworks": ["CIS"],
  "risk_score": 95,
  "exploitability": "confirmed",
  "blast_radius": "account",
  
  "pacu_module_used": "iam__privesc_scan",
  "pacu_test_result": {
    "success": true,
    "privileges_gained": [
      "iam:AttachUserPolicy",
      "iam:CreateAccessKey",
      "lambda:InvokeFunction"
    ],
    "escalation_path": [
      "PassRole to Lambda execution role",
      "Invoke Lambda with admin role",
      "Gain AdministratorAccess"
    ],
    "execution_time_seconds": 8.2,
    "notes": "Successfully escalated to admin in test environment"
  },
  
  "remediation_steps": [
    "Remove iam:PassRole permission from dev-user",
    "Implement SCPs to restrict Lambda role assumptions",
    "Enable CloudTrail logging for privilege changes",
    "Rotate credentials for affected user"
  ],
  "automated_fix_available": false,
  
  "status": "open",
  "created_at": "2024-01-15T10:32:00Z",
  "updated_at": "2024-01-15T10:32:00Z",
  "metadata": {
    "technique": "PassRole + Lambda",
    "attack_vector": "privilege_escalation",
    "validation_timestamp": "2024-01-15T10:32:00Z"
  }
}
```

## Table: HivemindFindingsArchive

Historical findings from completed missions. Uses identical schema to `HivemindFindings` with additional archival metadata.

### Additional Attributes
- `archived_at` (String): ISO 8601 timestamp when finding was archived
- `resolution_notes` (String): Notes on how finding was resolved
- `time_to_resolution_hours` (Number): Hours from detection to resolution

## Table: HivemindMissions

Mission/scan metadata and status tracking.

### Schema Extensions for AWS Scans

#### Partition Key
- `mission_id` (String): Unique mission identifier

#### Common Attributes
- `scan_type` (String): `"code"` | `"container"` | `"aws"`
- `status` (String): Mission status
- `created_at` (String): ISO 8601 timestamp
- `updated_at` (String): ISO 8601 timestamp

#### AWS Scan Attributes

When `scan_type == "aws"`:

```json
{
  "mission_id": "aws-scan-2024-01-15-12345",
  "scan_type": "aws",
  "status": "completed",
  
  "aws_scan_config": {
    "account_id": "123456789012",
    "regions": ["us-east-1", "us-west-2", "eu-west-1"],
    "services_scanned": ["IAM", "S3", "EC2", "Lambda", "RDS", "VPC"],
    "environment": "production"
  },
  
  "tools_executed": [
    {
      "name": "scoutsuite-mcp",
      "status": "completed",
      "findings_count": 47,
      "execution_time_seconds": 180
    },
    {
      "name": "pacu-mcp",
      "status": "completed",
      "findings_count": 12,
      "execution_time_seconds": 95,
      "validated_findings": 5
    }
  ],
  
  "findings_summary": {
    "total": 59,
    "by_severity": {
      "CRITICAL": 3,
      "HIGH": 12,
      "MEDIUM": 28,
      "LOW": 16
    },
    "by_service": {
      "IAM": 15,
      "S3": 18,
      "EC2": 10,
      "Lambda": 8,
      "RDS": 5,
      "VPC": 3
    },
    "exploitable_count": 5
  },
  
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:38:00Z",
  "completed_at": "2024-01-15T10:38:00Z"
}
```

## Query Patterns

### Get All AWS Findings for a Mission
```python
response = table.query(
    KeyConditionExpression=Key('mission_id').eq('aws-scan-2024-01-15-12345')
)
```

### Get Critical AWS Findings by Service
```python
response = table.query(
    KeyConditionExpression=Key('mission_id').eq('aws-scan-2024-01-15-12345'),
    FilterExpression=Attr('severity').eq('CRITICAL') & Attr('aws_service').eq('IAM')
)
```

### Get Confirmed Exploitable Findings
```python
response = table.query(
    KeyConditionExpression=Key('mission_id').eq('aws-scan-2024-01-15-12345'),
    FilterExpression=Attr('exploitability').eq('confirmed')
)
```

### Get Findings by Compliance Framework
```python
response = table.query(
    KeyConditionExpression=Key('mission_id').eq('aws-scan-2024-01-15-12345'),
    FilterExpression=Attr('compliance_frameworks').contains('PCI-DSS')
)
```

## Global Secondary Indexes (Recommended)

To efficiently query across missions, consider adding:

### 1. ByServiceAndSeverity
- Partition Key: `aws_service`
- Sort Key: `severity#created_at`
- Enables queries like: "All S3 HIGH severity findings across all missions"

### 2. ByExploitability
- Partition Key: `scan_type#exploitability`
- Sort Key: `created_at`
- Enables queries like: "All confirmed exploitable AWS findings"

### 3. ByComplianceFramework
- Partition Key: `compliance_framework`
- Sort Key: `severity#created_at`
- Enables queries like: "All CIS benchmark violations"

## Migration from Existing Schema

The schema is backward compatible. Existing code scan findings continue to work without changes. AWS findings simply populate additional AWS-specific attributes.

### Differentiation Logic
```python
def is_aws_finding(finding):
    return finding.get('scan_type') == 'aws'

def is_code_finding(finding):
    return finding.get('scan_type') in ['code', 'container']
```

## Storage Considerations

- **Item Size**: AWS findings with Pacu test results can be larger (up to 50KB). Monitor item sizes.
- **TTL**: Consider setting TTL on archived findings older than 1 year
- **Projection**: Use GSI projections to reduce storage costs for frequently queried attributes

## Best Practices

1. **Always Set scan_type**: Ensures proper filtering and reporting
2. **Normalize aws_service**: Use consistent service names (e.g., "S3" not "s3" or "Simple Storage Service")
3. **Include resource_id**: Always store ARN or resource ID for tracking
4. **Update exploitability**: When Pacu validates a finding, update the original ScoutSuite finding's exploitability field
5. **Link Related Findings**: Use metadata to link ScoutSuite findings to their Pacu validation results

## Example: Linking ScoutSuite and Pacu Findings

```python
# ScoutSuite finding
scoutsuite_finding = {
    "finding_id": "scoutsuite-1705320000-a1b2c3d4",
    "metadata": {
        "pacu_validation_id": None  # Will be updated after Pacu scan
    }
}

# After Pacu validation
pacu_finding = {
    "finding_id": "pacu-1705320120-e5f6g7h8",
    "metadata": {
        "validates_finding": "scoutsuite-1705320000-a1b2c3d4"
    }
}

# Update ScoutSuite finding
table.update_item(
    Key={'mission_id': mission_id, 'finding_id': 'scoutsuite-1705320000-a1b2c3d4'},
    UpdateExpression='SET exploitability = :exp, #meta.pacu_validation_id = :pacu_id',
    ExpressionAttributeValues={
        ':exp': 'confirmed',
        ':pacu_id': 'pacu-1705320120-e5f6g7h8'
    },
    ExpressionAttributeNames={'#meta': 'metadata'}
)
```

## Conclusion

This schema extension enables comprehensive AWS security findings storage while maintaining compatibility with existing code security workflows. The addition of `scan_type` and AWS-specific attributes provides rich context for security teams to prioritize and remediate infrastructure vulnerabilities.