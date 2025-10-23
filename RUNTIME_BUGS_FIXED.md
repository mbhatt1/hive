# Runtime Bugs Fixed - Complete List

## Critical State Machine Bugs (5)

### 1. Duplicate Coordinator State
**File**: `infrastructure/stacks/orchestration-stack.ts:63-82`
**Severity**: CRITICAL - Would cause state machine to fail on execution
**Problem**: Both AWS and Code scan paths reused the same `coordinatorTask` instance, violating Step Functions rule that each state can only have one parent
**Fix**: Created separate `coordinatorTaskAWS` and `coordinatorTaskCode` instances with `mergeBranches` Pass state

### 2. Data Flow Break: Coordinator → Synthesizer  
**File**: `src/agents/coordinator/agent.py:319-361`
**Severity**: CRITICAL - Synthesizer would receive no data
**Problem**: Coordinator stored tool results ONLY to S3, but Synthesizer reads from DynamoDB
**Fix**: Added DynamoDB storage logic to write tool results to both S3 (archival) and DynamoDB (for consumption)

### 3. Missing Error Handling
**File**: `infrastructure/stacks/orchestration-stack.ts:174-205`
**Severity**: HIGH - Failures would hang indefinitely  
**Problem**: Only unpack task had error handling; failures in coordinator, synthesis, or archivist would not be caught
**Fix**: Added `.addCatch(handleFailure)` to coordinatorTaskAWS, coordinatorTaskCode, synthesisCrucible, and archivistTask

### 4. Hardcoded Scan Type
**File**: `src/lambdas/unpack/index.py:49-107`
**Severity**: MEDIUM - AWS scans would incorrectly follow code path
**Problem**: Scan type hardcoded to 'code', ignoring metadata configuration
**Fix**: Read `scan_type` from metadata.json with proper fallback to 'code'

### 5. Wrong Timestamp Function
**Files**: `src/agents/synthesizer/agent.py`, `src/agents/critic/agent.py`, `src/agents/archivist/agent.py`, `src/agents/strategist/agent.py`
**Severity**: MEDIUM - State tracking timing would be incorrect
**Problem**: Agents used `os.times().elapsed` (process CPU time) instead of `time.time()` (wall clock time)
**Fix**: Changed all instances to `time.time()` for proper Unix timestamps

## Critical Networking Bugs (6)

### 6. Gateway Endpoints Missing Subnet
**File**: `infrastructure/stacks/network-stack.ts:43-58`
**Severity**: CRITICAL - Lambdas in PRIVATE_ISOLATED couldn't reach S3/DynamoDB
**Problem**: S3/DynamoDB gateway endpoints only in PRIVATE_ISOLATED, but agents run in PRIVATE_WITH_EGRESS
**Fix**: Added endpoints to BOTH `PRIVATE_WITH_EGRESS` and `PRIVATE_ISOLATED` subnets

### 7. Interface Endpoints Wrong Subnet
**File**: `infrastructure/stacks/network-stack.ts:112-151`  
**Severity**: CRITICAL - Services couldn't communicate
**Problem**: Interface endpoints hardcoded to PRIVATE_ISOLATED, agents run in PRIVATE_WITH_EGRESS
**Fix**: Removed subnet restrictions to auto-deploy to all available subnets

### 8. Agent Can't Connect to Redis
**File**: `infrastructure/stacks/security-stack.ts:56-60`
**Severity**: CRITICAL - All agent state tracking would fail
**Problem**: Agent security group had no egress rule to ElastiCache
**Fix**: Added egress rule: agents → ElastiCache on port 6379

### 9. Lambda Missing Security Group
**Files**: `infrastructure/stacks/security-stack.ts:71-105`, `infrastructure/stacks/compute-stack.ts:18,296-351`
**Severity**: CRITICAL - Lambdas couldn't access AWS services
**Problem**: Lambdas deployed in VPC without security group, couldn't reach VPC endpoints
**Fix**: Created `lambdaSecurityGroup` with VPC endpoint access, added to all Lambda functions

### 10. Missing VPC Endpoints
**File**: `infrastructure/stacks/network-stack.ts:109-115`
**Severity**: HIGH - Services would be unavailable
**Problem**: Missing Lambda and Kendra VPC endpoints
**Fix**: Added Lambda and Kendra to interface endpoints list

### 11. VPC Endpoint Security Group Not Configured
**File**: `infrastructure/stacks/security-stack.ts:99-105`
**Severity**: HIGH - Lambdas blocked from endpoints
**Problem**: VPC endpoint security group didn't allow ingress from Lambda security group
**Fix**: Added ingress rule for Lambda → VPC endpoints on port 443

## IAM & Permissions Bugs (3)

### 12. Archivist Can't Invoke Lambda
**File**: `infrastructure/stacks/compute-stack.ts:273-280`
**Severity**: HIGH - Memory ingestion would fail
**Problem**: Archivist agent has no permission to invoke MemoryIngestor Lambda
**Fix**: Added `lambda:InvokeFunction` permission for MemoryIngestor to archivist role

### 13. Missing Bedrock Permission
**File**: `infrastructure/stacks/compute-stack.ts:113-127`
**Severity**: MEDIUM - Model discovery might fail
**Problem**: Agents missing `bedrock:ListFoundationModels` permission
**Fix**: Added to bedrock policy for all agent roles

### 14. Lambda Security Group Not Passed to Stack
**File**: `bin/app.ts:88`
**Severity**: CRITICAL - Stack instantiation would fail
**Problem**: ComputeStack requires `lambdaSecurityGroup` but wasn't being passed from SecurityStack
**Fix**: Added `lambdaSecurityGroup: securityStack.lambdaSecurityGroup` to stack props

## Configuration Bugs (4)

### 15. Missing AWS_REGION in Lambdas
**File**: `infrastructure/stacks/compute-stack.ts:289-345`
**Severity**: HIGH - Boto3 clients would use wrong region
**Problem**: Lambda functions missing AWS_REGION environment variable
**Fix**: Added `AWS_REGION: cdk.Stack.of(this).region` to all three Lambda functions

### 16. Dummy Environment Variables
**Files**: All agent and lambda files
**Severity**: HIGH - Silent configuration failures
**Problem**: Fallback values like `'test-scan-123'` hide missing configuration
**Fix**: Removed all fallback values except for optional SNS_TOPIC_ARN - fail fast on missing required vars

### 17. S3 Import Logic Broken
**File**: `infrastructure/stacks/storage-stack.ts:32-97`
**Severity**: HIGH - Bucket creation would fail
**Problem**: `Bucket.fromBucketName() || new Bucket()` doesn't work - fromBucketName returns object that evaluates to true
**Fix**: Removed import logic, always create new buckets

### 18. Missing Agent Requirements Installation
**File**: `src/agents/coordinator/Dockerfile:15-17`
**Severity**: HIGH - Coordinator would crash on boto3/redis import
**Problem**: Dockerfile didn't install agent-specific requirements.txt (boto3, redis)
**Fix**: Added COPY and RUN for agent requirements.txt

## Remaining Issues to Fix

### Other Agent Dockerfiles
All other agents (archaeologist, strategist, synthesizer, critic, archivist) likely have same Dockerfile issue - not installing their requirements.txt files

### Event Output Format
Agents need to print JSON output that Step Functions can parse and merge into state

### ECS Task Definition Memory/CPU
May need adjustment based on actual workload

### ElastiCache Subnet Placement
Verify ElastiCache is in correct subnet group for agent connectivity

## Testing Checklist

- [ ] Deploy all stacks
- [ ] Upload test code archive
- [ ] Verify EventBridge triggers state machine
- [ ] Check unpack Lambda executes successfully
- [ ] Verify agents can connect to Redis
- [ ] Verify agents can read/write S3
- [ ] Verify agents can read/write DynamoDB
- [ ] Verify Coordinator writes to tool results table
- [ ] Verify Synthesizer reads from tool results table
- [ ] Verify error handling triggers failure Lambda
- [ ] Check all CloudWatch logs for errors