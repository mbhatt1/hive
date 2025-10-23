# Runtime Bugs Fixed in State Machine

## Summary
Fixed 6 critical runtime bugs that would have caused state machine failures during execution.

## Bugs Fixed

### 1. State Machine Flow - Duplicate Coordinator State (CRITICAL)
**Location**: `infrastructure/stacks/orchestration-stack.ts`

**Problem**: Both AWS and Code scan paths were flowing to the same `coordinatorTask` state instance, violating Step Functions constraint that each state can only have one parent.

**Fix**: 
- Created separate coordinator task instances: `coordinatorTaskAWS` and `coordinatorTaskCode`
- Added `mergeBranches` Pass state to properly merge execution paths before synthesis
- Both coordinator paths now flow through merge before continuing to synthesis

**Impact**: Without this fix, state machine deployment would succeed but execution would fail with state transition errors.

---

### 2. Missing Error Handling (HIGH)
**Location**: `infrastructure/stacks/orchestration-stack.ts`

**Problem**: Only the unpack task had error handling. Critical failures in coordinator, synthesis, or archivist would not be caught.

**Fix**: Added `.addCatch(handleFailure)` to:
- `coordinatorTaskAWS`
- `coordinatorTaskCode`
- `synthesisCrucible`
- `archivistTask`

**Impact**: Failures would have caused executions to hang or terminate without proper cleanup.

---

### 3. Scan Type Hardcoded (MEDIUM)
**Location**: `src/lambdas/unpack/index.py`

**Problem**: Scan type was hardcoded to 'code', ignoring metadata configuration. AWS scans would always follow code path.

**Fix**: 
- Read `scan_type` from metadata.json
- Default to 'code' if not specified
- Pass correct scan_type to state machine

**Impact**: AWS security scans would incorrectly trigger code analysis agents.

---

### 4. Incorrect Timestamp Function (MEDIUM)
**Location**: Multiple agent files

**Problem**: Agents used `os.times().elapsed` which returns process CPU time, not wall clock time. This caused:
- Incorrect heartbeat timestamps in Redis
- Invalid proposal timestamps in negotiation
- Potential timing-based bugs in consensus

**Files Fixed**:
- `src/agents/synthesizer/agent.py`
- `src/agents/critic/agent.py`
- `src/agents/archivist/agent.py`
- `src/agents/strategist/agent.py`

**Fix**: Changed all instances to `time.time()` for proper Unix timestamps.

**Impact**: State tracking and negotiation timing would be incorrect.

---

### 5. Data Flow Mismatch - Coordinator → Synthesizer (CRITICAL)
**Location**: `src/agents/coordinator/agent.py`

**Problem**: Coordinator stored MCP tool results ONLY to S3, but Synthesizer reads from DynamoDB. Tool results would never reach Synthesizer.

**Fix**:
- Added DynamoDB client to Coordinator
- Store tool results to both S3 (for archival) and DynamoDB (for Synthesizer)
- Each successful tool execution creates a DynamoDB record with:
  - `mission_id` (partition key)
  - `tool_name` (sort key)
  - `s3_uri` (pointer to full results)
  - `digest` (for evidence chain verification)
  - `findings_count`

**Impact**: Synthesizer would find no tool results, generating empty findings.

---

### 6. Missing Environment Variable
**Location**: `src/agents/coordinator/agent.py`

**Problem**: Coordinator didn't have `DYNAMODB_TOOL_RESULTS_TABLE` environment variable defined.

**Fix**: Added environment variable to constructor with default fallback.

**Impact**: Would cause runtime errors when trying to store tool results.

---

## Testing Recommendations

1. **State Machine Flow**
   - Test both AWS and Code scan paths end-to-end
   - Verify merge state properly combines execution contexts
   - Check error paths trigger failure handler correctly

2. **Data Flow**
   - Verify Coordinator stores results to DynamoDB
   - Confirm Synthesizer can read tool results
   - Validate evidence chain digests match

3. **Timing**
   - Monitor Redis heartbeats use correct timestamps
   - Verify negotiation timing is accurate
   - Check state transitions complete within expected timeframes

4. **Error Recovery**
   - Inject failures at each critical step
   - Verify failure handler receives proper error context
   - Confirm mission status updates to FAILED correctly

## Deployment Notes

All fixes are backward compatible. No database schema changes required. The CDK deployment will update:
- Step Functions state machine definition
- Lambda functions
- ECS task definitions with new agent images

Estimated deployment time: 5-10 minutes