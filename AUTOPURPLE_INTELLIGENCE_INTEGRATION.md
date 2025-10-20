# AutoPurple Intelligence Integration Guide

This document explains how to integrate AutoPurple's intelligent orchestration logic into Hivemind-Prism's existing architecture.

## The Intelligence Gap

Current integration provides **basic tool execution**:
- ScoutSuite MCP: Runs scans, returns findings
- Pacu MCP: Validates findings using hardcoded module mapping

AutoPurple provides **intelligent orchestration**:
- **Claude analysis**: Prioritizes findings by exploitability
- **Smart module selection**: Chooses Pacu modules based on finding analysis
- **Remediation planning**: Generates actionable fix steps
- **Post-validation**: Confirms remediations worked

## Architecture: Where Intelligence Lives

```
┌─────────────────────────────────────────────────────────────┐
│ AutoPurple (Monolithic)                                     │
├─────────────────────────────────────────────────────────────┤
│ ScoutSuite → ClaudePlanner.analyze_findings() →             │
│ ClaudePlanner.select_pacu_modules() → Pacu → Validate →    │
│ ClaudePlanner.plan_remediation() → Execute                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Hivemind-Prism (Distributed Agents)                        │
├─────────────────────────────────────────────────────────────┤
│ ScoutSuite MCP → Strategist (needs Claude analysis) →      │
│ Coordinator → Pacu MCP (needs smart module selection) →    │
│ Synthesizer (needs aggregation) → Critic (needs analysis)  │
└─────────────────────────────────────────────────────────────┘
```

## Integration Strategy

### Option 1: Enhance Strategist Agent (RECOMMENDED)

The **Strategist agent** should incorporate AutoPurple's [`ClaudePlanner.analyze_findings()`](autopurple/autopurple/orchestrator/planner.py:50) logic.

#### Current Strategist Logic
```python
# src/agents/strategist/agent.py:93
def _plan_execution(self, context: Dict) -> Dict:
    # Simple: Just selects tools based on scan_type
    if scan_type == 'aws':
        return {'tools': ['scoutsuite-mcp', 'pacu-mcp']}
```

#### Enhanced Strategist Logic
```python
# src/agents/strategist/agent.py (enhanced)
def _plan_execution(self, context: Dict) -> Dict:
    if context.get('scan_type') == 'aws':
        # Step 1: Check if ScoutSuite findings exist
        scoutsuite_findings = self._get_scoutsuite_findings()
        
        if scoutsuite_findings:
            # Step 2: Use Claude to analyze and prioritize
            analysis = self._analyze_findings_with_claude(scoutsuite_findings)
            
            # Step 3: Intelligent tool selection
            tools = []
            
            # Always include ScoutSuite first
            tools.append({
                'name': 'scoutsuite-mcp',
                'task_definition': 'hivemind-scoutsuite-mcp',
                'priority': 1
            })
            
            # Add Pacu only if high-priority exploitable findings exist
            if self._has_exploitable_findings(analysis):
                tools.append({
                    'name': 'pacu-mcp',
                    'task_definition': 'hivemind-pacu-mcp',
                    'priority': 2,
                    'context': {
                        'priority_findings': analysis['priority_findings'],
                        'recommended_modules': analysis['recommended_modules']
                    }
                })
            
            return {'tools': tools, 'analysis': analysis}
        else:
            # First run: just ScoutSuite
            return {'tools': [{'name': 'scoutsuite-mcp', ...}]}
```

#### Claude Analysis Prompt (from AutoPurple)
```python
def _analyze_findings_with_claude(self, findings: List[Dict]) -> Dict:
    """Adapted from autopurple/orchestrator/planner.py:84"""
    
    prompt = f"""You are an AWS security expert analyzing findings from ScoutSuite.

Findings to analyze:
{json.dumps(findings, indent=2)}

Analyze and provide:
1. **Clustering**: Group similar findings
2. **Prioritization**: Rank by exploitability (not just severity)
3. **Module Selection**: Which Pacu modules would validate each finding
4. **Attack Paths**: Identify potential privilege escalation chains

Pacu modules available:
- iam__privesc_scan: Test IAM privilege escalation
- iam__enum_permissions: Enumerate permissions
- s3__bucket_finder: Find accessible S3 buckets
- s3__download_bucket: Test bucket access
- ec2__enum_lateral_movement: Test lateral movement
- lambda__enum: Enumerate Lambda functions
- rds__enum: Enumerate RDS instances

Return JSON:
{{
  "priority_findings": [
    {{
      "finding_id": "string",
      "priority_score": 1-10,
      "exploitability": "low|medium|high|critical",
      "recommended_modules": ["module1", "module2"],
      "rationale": "why"
    }}
  ],
  "attack_paths": [
    {{
      "description": "S3 read -> IAM escalation -> admin",
      "findings_involved": ["finding1", "finding2"],
      "modules_needed": ["iam__privesc_scan"]
    }}
  ]
}}"""
    
    response = self.cognitive_kernel.invoke_claude(
        system_prompt="You are an AWS security expert.",
        user_prompt=prompt,
        temperature=0.3
    )
    
    return json.loads(response.content)
```

### Option 2: Create AWS Orchestrator Agent

Create a dedicated agent that wraps AutoPurple's full pipeline logic:

```python
# src/agents/aws_orchestrator/agent.py
class AWSSecurityOrchestrator:
    """Intelligent orchestrator for AWS security scanning.
    
    Adapts AutoPurple's pipeline logic to Hivemind architecture:
    - Phase 1: Discovery (ScoutSuite MCP)
    - Phase 2: Analysis (Claude via CognitiveKernel)
    - Phase 3: Validation (Pacu MCP with smart module selection)
    - Phase 4: Remediation Planning (Claude)
    """
    
    async def run(self):
        # Phase 1: Discovery
        scoutsuite_findings = await self._run_scoutsuite_mcp()
        
        # Phase 2: Analysis (AutoPurple's ClaudePlanner.analyze_findings)
        analysis = await self._analyze_with_claude(scoutsuite_findings)
        
        # Phase 3: Validation (AutoPurple's pipeline._validate_findings)
        validated = await self._run_pacu_with_smart_modules(
            analysis['priority_findings']
        )
        
        # Phase 4: Planning (AutoPurple's ClaudePlanner.plan_remediation)
        remediation_plans = await self._plan_remediations(validated)
        
        # Phase 5: Output
        return self._write_comprehensive_report()
```

### Option 3: Enhance MCP Servers Directly

Add intelligence directly to MCP servers (less flexible):

```python
# src/mcp_servers/pacu_mcp/server.py (enhanced)
class PacuMCPServer:
    def __init__(self):
        self.bedrock = boto3.client('bedrock-runtime')
    
    def validate_findings(self, findings: List[Dict]) -> Dict:
        # Step 1: Analyze with Claude
        analysis = self._analyze_findings_with_bedrock(findings)
        
        # Step 2: Smart module selection
        validations = []
        for priority_finding in analysis['priority_findings'][:10]:
            modules = priority_finding['recommended_modules']
            
            for module in modules:
                result = self._run_pacu_module(module, priority_finding)
                validations.append(result)
        
        return {'validations': validations, 'analysis': analysis}
```

## Specific Enhancements Needed

### 1. Strategist Agent Enhancement

**File**: [`src/agents/strategist/agent.py`](src/agents/strategist/agent.py)

**Add method**:
```python
def _analyze_aws_findings(self, findings: List[Dict]) -> Dict:
    """Analyze AWS findings using Claude (AutoPurple's intelligence)."""
    # Use AutoPurple's prompt from planner.py:84-129
    # Returns: priority_findings, clusters, attack_paths
```

**Add method**:
```python
def _select_pacu_modules_intelligently(self, analysis: Dict) -> List[str]:
    """Select Pacu modules based on Claude analysis, not hardcoded rules."""
    # Extracts recommended_modules from Claude analysis
    # Returns: ['iam__privesc_scan', 's3__bucket_finder', ...]
```

### 2. Synthesizer Agent Enhancement

**File**: [`src/agents/synthesizer/agent.py`](src/agents/synthesizer/agent.py)

**Add capability**: Correlate ScoutSuite + Pacu results

```python
def _correlate_findings(self, scoutsuite_results, pacu_results):
    """Match Pacu validations back to ScoutSuite findings.
    
    AutoPurple does this in pipeline.py:208-223:
    - Updates finding.status based on validation
    - Marks exploitable vs dismissed
    """
    for validation in pacu_results:
        original_finding = find_by_id(validation['finding_id'])
        if validation['exploitable']:
            original_finding['exploitability'] = 'confirmed'
            original_finding['pacu_validation'] = validation
        else:
            original_finding['exploitability'] = 'unlikely'
```

### 3. Critic Agent Enhancement

**File**: [`src/agents/critic/agent.py`](src/agents/critic/agent.py)

**Add capability**: Generate remediation plans using Claude

```python
def _generate_remediation_plan(self, finding: Dict) -> Dict:
    """Generate actionable remediation using Claude.
    
    Based on AutoPurple's ClaudePlanner.plan_remediation (planner.py:202-228):
    - Pre-checks
    - Remediation steps (with IaC code)
    - Rollback plan
    - Success criteria
    """
    prompt = f"""Generate remediation for:
Finding: {finding['title']}
Service: {finding['service']}
Evidence: {finding['evidence']}

Provide:
1. Pre-checks
2. Terraform/CloudFormation code to fix
3. Rollback steps
4. Validation method

Return JSON with structure..."""
```

## Implementation Priority

### Phase 1: Core Intelligence (Highest Priority)
1. ✅ Enhance **Strategist agent** with Claude-based finding analysis
2. ✅ Add intelligent Pacu module selection to Strategist
3. ✅ Pass analysis context to Pacu MCP via environment variables

### Phase 2: Enhanced Analysis
4. Enhance **Synthesizer agent** to correlate ScoutSuite + Pacu results
5. Add finding prioritization based on exploitability

### Phase 3: Remediation Intelligence
6. Enhance **Critic agent** with Claude-based remediation planning
7. Generate IaC code (Terraform/CloudFormation) for fixes

### Phase 4: Closed-Loop Validation
8. Implement post-remediation validation (AutoPurple's validators.py)
9. Confirm fixes actually worked

## Code Patterns from AutoPurple

### Pattern 1: Claude Analysis
```python
# From autopurple/orchestrator/planner.py:131-171
response = anthropic_client.messages.create(
    model="claude-3-5-haiku-20241022",
    max_tokens=4000,
    messages=[{"role": "user", "content": prompt}]
)
analysis = json.loads(response.content[0].text)
```

**Hive equivalent**:
```python
# src/agents/strategist/agent.py
response = self.cognitive_kernel.invoke_claude(
    system_prompt="You are an AWS security expert",
    user_prompt=analysis_prompt,
    temperature=0.3
)
analysis = json.loads(response.content)
```

### Pattern 2: Smart Module Selection
```python
# From autopurple/orchestrator/pipeline.py:208-223
async def validate_finding(finding: Finding) -> Finding:
    # Claude already selected modules in analysis phase
    modules = finding.recommended_modules
    
    for module in modules:
        validation = await pacu.validate_finding(finding, module)
        if validation.is_exploitable:
            finding.update_status('validated')
            break  # Stop testing if confirmed exploitable
```

**Hive equivalent**:
```python
# src/agents/strategist/agent.py
def _create_pacu_task_definition(self, analysis: Dict) -> Dict:
    return {
        'name': 'pacu-mcp',
        'task_definition': 'hivemind-pacu-mcp',
        'environment': {
            'PRIORITY_FINDINGS': json.dumps(analysis['priority_findings']),
            'RECOMMENDED_MODULES': json.dumps(analysis['modules_by_finding'])
        }
    }
```

### Pattern 3: Remediation Planning
```python
# From autopurple/orchestrator/planner.py:230-297
prompt = f"""Plan remediation for AWS finding:
{finding_details}

AWS Documentation:
{aws_docs_context}

Return JSON with:
- pre_checks
- remediation_steps (with MCP calls)
- rollback_plan
- success_criteria
"""
```

## Testing the Enhanced Integration

### Test 1: Intelligent Module Selection
```python
# Setup: Run ScoutSuite, get findings with various severities
findings = [
    {'service': 'IAM', 'title': 'User can escalate privileges', 'severity': 'HIGH'},
    {'service': 'S3', 'title': 'Bucket publicly accessible', 'severity': 'CRITICAL'},
    {'service': 'EC2', 'title': 'Security group allows 0.0.0.0/0', 'severity': 'MEDIUM'}
]

# Expected: Claude prioritizes S3 (CRITICAL + publicly accessible = immediate risk)
#           Then IAM (HIGH + privilege escalation = attack path)
#           EC2 is deprioritized (MEDIUM + common finding)

analysis = strategist._analyze_aws_findings(findings)

assert analysis['priority_findings'][0]['finding_id'] == 's3_bucket_finding'
assert 's3__download_bucket' in analysis['priority_findings'][0]['recommended_modules']
```

### Test 2: Attack Path Detection
```python
# Setup: Findings that form an attack chain
findings = [
    {'id': 'f1', 'service': 'S3', 'title': 'Bucket read access'},
    {'id': 'f2', 'service': 'IAM', 'title': 'Role assumable from S3'},
    {'id': 'f3', 'service': 'IAM', 'title': 'Role has admin access'}
]

analysis = strategist._analyze_aws_findings(findings)

# Expected: Claude identifies attack path: S3 read -> assume role -> admin
assert len(analysis['attack_paths']) > 0
assert analysis['attack_paths'][0]['findings_involved'] == ['f1', 'f2', 'f3']
```

## Migration Path

### Week 1: Add Intelligence to Strategist
- [ ] Import Claude analysis logic from AutoPurple
- [ ] Enhance `_plan_execution()` with finding analysis
- [ ] Test with sample ScoutSuite findings

### Week 2: Enhance Pacu Module Selection
- [ ] Pass analysis context to Pacu MCP
- [ ] Use recommended modules from Claude
- [ ] Validate module selection accuracy

### Week 3: Add Remediation Planning
- [ ] Enhance Critic agent with remediation logic
- [ ] Generate IaC code for fixes
- [ ] Test remediation plan quality

### Week 4: Integration Testing
- [ ] End-to-end test: AWS scan → analysis → validation → remediation
- [ ] Compare results with AutoPurple baseline
- [ ] Measure improvement in finding prioritization

## Success Metrics

1. **Reduced False Positives**: Pacu confirms <50% of ScoutSuite findings are exploitable
2. **Better Prioritization**: Claude-selected findings are more critical than rule-based
3. **Actionable Remediations**: >80% of plans include working IaC code
4. **Attack Path Detection**: Identifies privilege escalation chains missed by individual tools

## Conclusion

The key to effective integration is **not just running the tools**, but **intelligently orchestrating them with Claude**:

- **Analysis**: Claude prioritizes findings by real exploitability
- **Selection**: Smart Pacu module selection based on finding analysis
- **Planning**: Claude generates actionable remediation with IaC
- **Validation**: Confirms fixes actually work

This intelligence should live in **Strategist, Synthesizer, and Critic agents**, not the MCP servers themselves, to maintain Hivemind-Prism's distributed architecture while gaining AutoPurple's intelligence.