# Bug Fix TODO List - All 18 Infrastructure Bugs

## Critical Bugs (1-6)
- [x] 1. **Network Stack**: Fix subnet configuration - change PRIVATE_ISOLATED to PRIVATE_WITH_EGRESS or add NAT gateway
- [x] 2. **Orchestration Stack**: Fix subnet type mismatch - use PRIVATE_ISOLATED instead of PRIVATE_WITH_EGRESS
- [x] 3. **Storage Stack**: Fix ElastiCache subnet group - use isolatedSubnets instead of privateSubnets
- [x] 4. **Compute Stack**: Add missing IAM permissions for agents (S3, DynamoDB, ElastiCache)
- [x] 5. **Intelligence Stack**: Fix Kendra edition comment mismatch
- [x] 6. **App.ts**: Fix property name mismatch - findingsTable vs findingsArchiveTable

## Additional Bugs (7-18)
- [x] 7. **Compute Stack**: Fix incomplete code - complete removalPolicy line
- [x] 8. **Orchestration Stack**: Remove unused mcpTaskDefinitions parameter or implement usage
- [x] 9. **Security Stack**: Fix hardcoded resource names in IAM policies - use dynamic references
- [x] 10. **Network Stack**: Add security groups to VPC endpoints
- [x] 11. **Intelligence Stack**: Add KMS permissions to Kendra data source role
- [x] 12. **Storage Stack**: Export and use EventBus or remove it
- [x] 13. **Orchestration Stack**: Fix failure handler to use correct Lambda function
- [x] 14. **Compute Stack**: Add ElastiCache connection permissions for agents
- [x] 15. **App.ts**: Add environment variable validation
- [x] 16. **Orchestration Stack**: Fix EventBridge rule pattern for S3 events
- [x] 17. **Compute Stack**: Handle ECR repository existence gracefully
- [x] 18. **Storage Stack**: Fix Redis endpoint type issue for cluster mode

## Fix Order Priority:
1. Syntax errors (7)
2. Network connectivity (1, 2, 3, 10)
3. IAM permissions (4, 9, 11, 14)
4. Resource references (6, 8, 12, 13)
5. Configuration issues (5, 15, 16, 17, 18)