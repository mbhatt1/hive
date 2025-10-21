"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComputeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
class ComputeStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========== AGENT TASK ROLES ==========
        // Create agent roles here to avoid circular dependency with Security/Storage stacks
        this.agentTaskRoles = {
            archaeologist: this.createAgentRole('Archaeologist', 'Context discovery and metadata extraction'),
            strategist: this.createAgentRole('Strategist', 'Planning and tool selection'),
            coordinator: this.createAgentRole('Coordinator', 'Resource allocation and scheduling'),
            synthesizer: this.createAgentRole('Synthesizer', 'Finding generation from tool results'),
            critic: this.createAgentRole('Critic', 'Finding validation and challenge'),
            archivist: this.createAgentRole('Archivist', 'Final storage and memory formation'),
        };
        // MCP Server Task Role
        this.mcpServerTaskRole = new iam.Role(this, 'McpServerTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            roleName: 'HivemindMcpServerTaskRole',
            description: 'Role for MCP tool server tasks (code scanning + AWS security auditing)',
        });
        // Add AWS SecurityAudit managed policy for ScoutSuite/Pacu
        this.mcpServerTaskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('SecurityAudit'));
        // Additional permissions for ScoutSuite/Pacu AWS scanning
        this.mcpServerTaskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                // IAM read permissions
                'iam:GetAccountPasswordPolicy',
                'iam:GetAccountSummary',
                'iam:ListAccessKeys',
                'iam:ListMFADevices',
                'iam:ListVirtualMFADevices',
                // EC2 read permissions
                'ec2:DescribeImages',
                'ec2:DescribeSnapshots',
                'ec2:DescribeSnapshotAttribute',
                // S3 read permissions
                's3:GetBucketPublicAccessBlock',
                's3:GetBucketPolicyStatus',
                's3:GetAccountPublicAccessBlock',
                // Lambda read permissions
                'lambda:GetFunction',
                'lambda:GetFunctionConfiguration',
                'lambda:GetPolicy',
                // CloudTrail read permissions
                'cloudtrail:GetEventSelectors',
                'cloudtrail:GetTrailStatus',
                'cloudtrail:ListTags',
                // Config read permissions
                'config:DescribeConfigurationRecorders',
                'config:DescribeConfigurationRecorderStatus',
            ],
            resources: ['*'],
        }));
        // Secrets Manager access for AWS credentials
        this.mcpServerTaskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [
                `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:hivemind/aws-scan-credentials-*`,
            ],
        }));
        // Base policy for all agents - access to Bedrock and Kendra
        const bedrockKendraPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
                'kendra:Retrieve',
                'kendra:Query',
            ],
            resources: ['*'],
        });
        Object.values(this.agentTaskRoles).forEach((role) => {
            role.addToPolicy(bedrockKendraPolicy);
        });
        // Secrets Manager access for agents
        const secretsManagerPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['secretsmanager:GetSecretValue'],
            resources: [`arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:hivemind/*`],
        });
        Object.values(this.agentTaskRoles).forEach((role) => {
            role.addToPolicy(secretsManagerPolicy);
        });
        // X-Ray tracing for all agent roles
        const xrayPolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
            resources: ['*'],
        });
        Object.values(this.agentTaskRoles).forEach((role) => {
            role.addToPolicy(xrayPolicy);
        });
        // ========== LAMBDA EXECUTION ROLES ==========
        // Create Lambda roles here to avoid cyclic dependency
        const unpackLambdaRole = new iam.Role(this, 'UnpackLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            roleName: 'HivemindUnpackLambdaRole',
            description: 'Lambda execution role: Unpack and validate uploaded code',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        const memoryIngestorLambdaRole = new iam.Role(this, 'MemoryIngestorLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            roleName: 'HivemindMemoryIngestorRole',
            description: 'Lambda execution role: Create Kendra memory documents',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        const failureHandlerLambdaRole = new iam.Role(this, 'FailureHandlerLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            roleName: 'HivemindFailureHandlerRole',
            description: 'Lambda execution role: Handle mission failures',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Add X-Ray to Lambda roles (reuse same policy from agent roles above)
        [unpackLambdaRole, memoryIngestorLambdaRole, failureHandlerLambdaRole].forEach((role) => {
            role.addToPolicy(xrayPolicy);
        });
        // ========== ECS CLUSTER ==========
        this.ecsCluster = new ecs.Cluster(this, 'HivemindCluster', {
            clusterName: 'HivemindPrism',
            vpc: props.vpc,
            containerInsights: true,
            enableFargateCapacityProviders: true,
        });
        // ========== AGENT TASK DEFINITIONS ==========
        this.agentTaskDefinitions = {};
        const agentNames = ['archaeologist', 'strategist', 'coordinator', 'synthesizer', 'critic', 'archivist'];
        agentNames.forEach((agentName) => {
            const taskDef = new ecs.FargateTaskDefinition(this, `${agentName}TaskDef`, {
                family: `hivemind-${agentName}-agent`,
                cpu: 1024, // 1 vCPU
                memoryLimitMiB: 2048, // 2GB RAM
                taskRole: this.agentTaskRoles[agentName],
                executionRole: this.createExecutionRole(`${agentName}ExecutionRole`),
            });
            // Add container - ECR repo must exist before deployment
            const ecrRepo = ecr.Repository.fromRepositoryName(this, `${agentName}EcrRepo`, `hivemind-${agentName}`);
            const container = taskDef.addContainer(`${agentName}Container`, {
                containerName: `${agentName}-agent`,
                image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
                logging: ecs.LogDriver.awsLogs({
                    streamPrefix: agentName,
                    logGroup: new logs.LogGroup(this, `${agentName}LogGroup`, {
                        logGroupName: `/ecs/${agentName}-agent`,
                        retention: logs.RetentionDays.ONE_WEEK,
                        removalPolicy: cdk.RemovalPolicy.DESTROY,
                    }),
                }),
                environment: {
                    AWS_REGION: cdk.Stack.of(this).region,
                    S3_ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
                    S3_KENDRA_BUCKET: props.kendraBucket.bucketName,
                    DYNAMODB_MISSION_TABLE: props.missionStatusTable.tableName,
                    DYNAMODB_TOOL_RESULTS_TABLE: props.toolResultsTable.tableName,
                    DYNAMODB_FINDINGS_TABLE: props.findingsTable.tableName,
                    REDIS_ENDPOINT: props.elastiCacheCluster.attrRedisEndpointAddress,
                    REDIS_PORT: props.elastiCacheCluster.attrRedisEndpointPort,
                    KENDRA_INDEX_ID: props.kendraIndex.attrId,
                    BEDROCK_MODEL_ID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                    AGENT_NAME: agentName,
                },
            });
            this.agentTaskDefinitions[agentName] = taskDef;
        });
        // Grant permissions to all agent roles
        Object.values(this.agentTaskRoles).forEach((role) => {
            props.artifactsBucket.grantReadWrite(role);
            props.uploadsBucket.grantRead(role);
            props.kendraBucket.grantReadWrite(role);
            props.missionStatusTable.grantReadWriteData(role);
            props.toolResultsTable.grantReadWriteData(role);
            props.findingsTable.grantReadWriteData(role);
            props.kmsKey.grantDecrypt(role);
        });
        // Add ElastiCache permissions for agents
        const elastiCachePolicy = new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'elasticache:DescribeCacheClusters',
                'elasticache:DescribeReplicationGroups',
            ],
            resources: ['*'],
        });
        Object.values(this.agentTaskRoles).forEach((role) => {
            role.addToPolicy(elastiCachePolicy);
        });
        // CLI permissions are granted via IAM policy in Security stack to avoid circular dependency
        // ========== MCP TOOL TASK DEFINITIONS ==========
        this.mcpTaskDefinitions = {};
        // Code scanning tools
        const mcpTools = ['semgrep-mcp', 'gitleaks-mcp', 'trivy-mcp', 'scoutsuite-mcp', 'pacu-mcp'];
        mcpTools.forEach((toolName) => {
            const taskDef = new ecs.FargateTaskDefinition(this, `${toolName}TaskDef`, {
                family: `hivemind-${toolName}`,
                cpu: 2048, // 2 vCPU for intensive scanning
                memoryLimitMiB: 4096, // 4GB RAM
                taskRole: this.mcpServerTaskRole,
                executionRole: this.createExecutionRole(`${toolName}ExecutionRole`),
            });
            // ECR repo must exist before deployment
            const ecrRepo = ecr.Repository.fromRepositoryName(this, `${toolName}EcrRepo`, toolName);
            const container = taskDef.addContainer(`${toolName}Container`, {
                containerName: toolName,
                image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
                logging: ecs.LogDriver.awsLogs({
                    streamPrefix: toolName,
                    logGroup: new logs.LogGroup(this, `${toolName}LogGroup`, {
                        logGroupName: `/ecs/${toolName}`,
                        retention: logs.RetentionDays.ONE_WEEK,
                        removalPolicy: cdk.RemovalPolicy.DESTROY,
                    }),
                }),
                environment: {
                    AWS_REGION: cdk.Stack.of(this).region,
                    S3_ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
                    DYNAMODB_TOOL_RESULTS_TABLE: props.toolResultsTable.tableName,
                    TOOL_NAME: toolName,
                },
            });
            // Grant permissions (read-only code, write-only results)
            props.artifactsBucket.grantRead(this.mcpServerTaskRole, 'unzipped/*');
            props.artifactsBucket.grantWrite(this.mcpServerTaskRole, `tool-results/${toolName}/*`);
            props.toolResultsTable.grantWriteData(this.mcpServerTaskRole);
            this.mcpTaskDefinitions[toolName] = taskDef;
        });
        // ========== LAMBDA FUNCTIONS ==========
        // Unpack Lambda
        this.unpackLambda = new lambda.Function(this, 'UnpackLambda', {
            functionName: 'HivemindUnpackAndValidate',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('src/lambdas/unpack'),
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            role: unpackLambdaRole,
            environment: {
                UPLOADS_BUCKET: props.uploadsBucket.bucketName,
                ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
                MISSION_TABLE: props.missionStatusTable.tableName,
            },
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        // Grant permissions
        props.uploadsBucket.grantRead(unpackLambdaRole);
        props.artifactsBucket.grantReadWrite(unpackLambdaRole);
        props.missionStatusTable.grantReadWriteData(unpackLambdaRole);
        props.kmsKey.grantDecrypt(unpackLambdaRole);
        // Memory Ingestor Lambda
        this.memoryIngestorLambda = new lambda.Function(this, 'MemoryIngestorLambda', {
            functionName: 'HivemindMemoryIngestor',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('src/lambdas/memory_ingestor'),
            timeout: cdk.Duration.minutes(2),
            memorySize: 256,
            role: memoryIngestorLambdaRole,
            environment: {
                FINDINGS_TABLE: props.findingsTable.tableName,
                KENDRA_BUCKET: props.kendraBucket.bucketName,
                KENDRA_INDEX_ID: props.kendraIndex.attrId,
            },
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        // Grant permissions
        props.findingsTable.grantReadData(memoryIngestorLambdaRole);
        props.kendraBucket.grantWrite(memoryIngestorLambdaRole);
        memoryIngestorLambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: ['kendra:BatchPutDocument'],
            resources: [props.kendraIndex.attrArn],
        }));
        // Failure Handler Lambda
        this.failureHandlerLambda = new lambda.Function(this, 'FailureHandlerLambda', {
            functionName: 'HivemindFailureHandler',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('src/lambdas/failure_handler'),
            timeout: cdk.Duration.minutes(1),
            memorySize: 128,
            role: failureHandlerLambdaRole,
            environment: {
                MISSION_TABLE: props.missionStatusTable.tableName,
            },
            vpc: props.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        // Grant permissions
        props.missionStatusTable.grantReadWriteData(failureHandlerLambdaRole);
        // ========== OUTPUTS ==========
        new cdk.CfnOutput(this, 'EcsClusterName', {
            value: this.ecsCluster.clusterName,
            description: 'ECS Cluster name',
            exportName: 'HivemindPrism-EcsCluster',
        });
        new cdk.CfnOutput(this, 'UnpackLambdaArn', {
            value: this.unpackLambda.functionArn,
            description: 'Unpack Lambda ARN',
        });
    }
    createExecutionRole(id) {
        const role = new iam.Role(this, id, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });
        // Add ECR permissions
        role.addToPolicy(new iam.PolicyStatement({
            actions: [
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
            ],
            resources: ['*'],
        }));
        return role;
    }
    createAgentRole(agentName, description) {
        return new iam.Role(this, `${agentName}TaskRole`, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            roleName: `Hivemind${agentName}TaskRole`,
            description: `ECS task role for ${agentName} agent: ${description}`,
        });
    }
}
exports.ComputeStack = ComputeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcHV0ZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9jb21wdXRlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsK0RBQWlEO0FBTWpELDJEQUE2QztBQWtCN0MsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFVekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF3QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix5Q0FBeUM7UUFDekMsb0ZBQW9GO1FBQ3BGLElBQUksQ0FBQyxjQUFjLEdBQUc7WUFDcEIsYUFBYSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsZUFBZSxFQUFFLDJDQUEyQyxDQUFDO1lBQ2pHLFVBQVUsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLFlBQVksRUFBRSw2QkFBNkIsQ0FBQztZQUM3RSxXQUFXLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxhQUFhLEVBQUUsb0NBQW9DLENBQUM7WUFDdEYsV0FBVyxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsYUFBYSxFQUFFLHNDQUFzQyxDQUFDO1lBQ3hGLE1BQU0sRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLFFBQVEsRUFBRSxrQ0FBa0MsQ0FBQztZQUMxRSxTQUFTLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxXQUFXLEVBQUUsb0NBQW9DLENBQUM7U0FDbkYsQ0FBQztRQUVGLHVCQUF1QjtRQUN2QixJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMvRCxTQUFT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eUJBQXlCLENBQUM7WUFDOUQsUUFBUSxFQUFFLFdBQVcsU0FBUyxVQUFVO1lBQ3hDLFdBQVcsRUFBRSxxQkFBcUIsU0FBUyxXQUFXLFdBQVcsRUFBRTtTQUNwRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFuWkQsb0NBbVpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgZWxhc3RpY2FjaGUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNhY2hlJztcbmltcG9ydCAqIGFzIGtlbmRyYSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta2VuZHJhJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcHV0ZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHZwYzogZWMyLlZwYztcbiAgYWdlbnRTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcbiAgbWNwVG9vbHNTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcbiAgdXBsb2Fkc0J1Y2tldDogczMuQnVja2V0O1xuICBhcnRpZmFjdHNCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAga2VuZHJhQnVja2V0OiBzMy5CdWNrZXQ7XG4gIG1pc3Npb25TdGF0dXNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHRvb2xSZXN1bHRzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBmaW5kaW5nc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgZWxhc3RpQ2FjaGVDbHVzdGVyOiBlbGFzdGljYWNoZS5DZm5DYWNoZUNsdXN0ZXI7XG4gIGtlbmRyYUluZGV4OiBrZW5kcmEuQ2ZuSW5kZXg7XG4gIGttc0tleToga21zLktleTtcbn1cblxuZXhwb3J0IGNsYXNzIENvbXB1dGVTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBlY3NDbHVzdGVyOiBlY3MuQ2x1c3RlcjtcbiAgcHVibGljIHJlYWRvbmx5IGFnZW50VGFza0RlZmluaXRpb25zOiB7IFtrZXk6IHN0cmluZ106IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24gfTtcbiAgcHVibGljIHJlYWRvbmx5IG1jcFRhc2tEZWZpbml0aW9uczogeyBba2V5OiBzdHJpbmddOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uIH07XG4gIHB1YmxpYyByZWFkb25seSB1bnBhY2tMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IG1lbW9yeUluZ2VzdG9yTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBmYWlsdXJlSGFuZGxlckxhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgYWdlbnRUYXNrUm9sZXM6IHsgW2tleTogc3RyaW5nXTogaWFtLlJvbGUgfTtcbiAgcHVibGljIHJlYWRvbmx5IG1jcFNlcnZlclRhc2tSb2xlOiBpYW0uUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ29tcHV0ZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT0gQUdFTlQgVEFTSyBST0xFUyA9PT09PT09PT09XG4gICAgLy8gQ3JlYXRlIGFnZW50IHJvbGVzIGhlcmUgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jeSB3aXRoIFNlY3VyaXR5L1N0b3JhZ2Ugc3RhY2tzXG4gICAgdGhpcy5hZ2VudFRhc2tSb2xlcyA9IHtcbiAgICAgIGFyY2hhZW9sb2dpc3Q6IHRoaXMuY3JlYXRlQWdlbnRSb2xlKCdBcmNoYWVvbG9naXN0JywgJ0NvbnRleHQgZGlzY292ZXJ5IGFuZCBtZXRhZGF0YSBleHRyYWN0aW9uJyksXG4gICAgICBzdHJhdGVnaXN0OiB0aGlzLmNyZWF0ZUFnZW50Um9sZSgnU3RyYXRlZ2lzdCcsICdQbGFubmluZyBhbmQgdG9vbCBzZWxlY3Rpb24nKSxcbiAgICAgIGNvb3JkaW5hdG9yOiB0aGlzLmNyZWF0ZUFnZW50Um9sZSgnQ29vcmRpbmF0b3InLCAnUmVzb3VyY2UgYWxsb2NhdGlvbiBhbmQgc2NoZWR1bGluZycpLFxuICAgICAgc3ludGhlc2l6ZXI6IHRoaXMuY3JlYXRlQWdlbnRSb2xlKCdTeW50aGVzaXplcicsICdGaW5kaW5nIGdlbmVyYXRpb24gZnJvbSB0b29sIHJlc3VsdHMnKSxcbiAgICAgIGNyaXRpYzogdGhpcy5jcmVhdGVBZ2VudFJvbGUoJ0NyaXRpYycsICdGaW5kaW5nIHZhbGlkYXRpb24gYW5kIGNoYWxsZW5nZScpLFxuICAgICAgYXJjaGl2aXN0OiB0aGlzLmNyZWF0ZUFnZW50Um9sZSgnQXJjaGl2aXN0JywgJ0ZpbmFsIHN0b3JhZ2UgYW5kIG1lbW9yeSBmb3JtYXRpb24nKSxcbiAgICB9O1xuXG4gICAgLy8gTUNQIFNlcnZlciBUYXNrIFJvbGVcbiAgICB0aGlzLm1jcFNlcnZlclRhc2tSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdNY3BTZXJ2ZXJUYXNrUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6ICdIaXZlbWluZE1jcFNlcnZlclRhc2tSb2xlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBmb3IgTUNQIHRvb2wgc2VydmVyIHRhc2tzIChjb2RlIHNjYW5uaW5nICsgQVdTIHNlY3VyaXR5IGF1ZGl0aW5nKScsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgQVdTIFNlY3VyaXR5QXVkaXQgbWFuYWdlZCBwb2xpY3kgZm9yIFNjb3V0U3VpdGUvUGFjdVxuICAgIHRoaXMubWNwU2VydmVyVGFza1JvbGUuYWRkTWFuYWdlZFBvbGljeShcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnU2VjdXJpdHlBdWRpdCcpXG4gICAgKTtcblxuICAgIC8vIEFkZGl0aW9uYWwgcGVybWlzc2lvbnMgZm9yIFNjb3V0U3VpdGUvUGFjdSBBV1Mgc2Nhbm5pbmdcbiAgICB0aGlzLm1jcFNlcnZlclRhc2tSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAvLyBJQU0gcmVhZCBwZXJtaXNzaW9uc1xuICAgICAgICAgICdpYW06R2V0QWNjb3VudFBhc3N3b3JkUG9saWN5JyxcbiAgICAgICAgICAnaWFtOkdldEFjY291bnRTdW1tYXJ5JyxcbiAgICAgICAgICAnaWFtOkxpc3RBY2Nlc3NLZXlzJyxcbiAgICAgICAgICAnaWFtOkxpc3RNRkFEZXZpY2VzJyxcbiAgICAgICAgICAnaWFtOkxpc3RWaXJ0dWFsTUZBRGV2aWNlcycsXG4gICAgICAgICAgLy8gRUMyIHJlYWQgcGVybWlzc2lvbnNcbiAgICAgICAgICAnZWMyOkRlc2NyaWJlSW1hZ2VzJyxcbiAgICAgICAgICAnZWMyOkRlc2NyaWJlU25hcHNob3RzJyxcbiAgICAgICAgICAnZWMyOkRlc2NyaWJlU25hcHNob3RBdHRyaWJ1dGUnLFxuICAgICAgICAgIC8vIFMzIHJlYWQgcGVybWlzc2lvbnNcbiAgICAgICAgICAnczM6R2V0QnVja2V0UHVibGljQWNjZXNzQmxvY2snLFxuICAgICAgICAgICdzMzpHZXRCdWNrZXRQb2xpY3lTdGF0dXMnLFxuICAgICAgICAgICdzMzpHZXRBY2NvdW50UHVibGljQWNjZXNzQmxvY2snLFxuICAgICAgICAgIC8vIExhbWJkYSByZWFkIHBlcm1pc3Npb25zXG4gICAgICAgICAgJ2xhbWJkYTpHZXRGdW5jdGlvbicsXG4gICAgICAgICAgJ2xhbWJkYTpHZXRGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICdsYW1iZGE6R2V0UG9saWN5JyxcbiAgICAgICAgICAvLyBDbG91ZFRyYWlsIHJlYWQgcGVybWlzc2lvbnNcbiAgICAgICAgICAnY2xvdWR0cmFpbDpHZXRFdmVudFNlbGVjdG9ycycsXG4gICAgICAgICAgJ2Nsb3VkdHJhaWw6R2V0VHJhaWxTdGF0dXMnLFxuICAgICAgICAgICdjbG91ZHRyYWlsOkxpc3RUYWdzJyxcbiAgICAgICAgICAvLyBDb25maWcgcmVhZCBwZXJtaXNzaW9uc1xuICAgICAgICAgICdjb25maWc6RGVzY3JpYmVDb25maWd1cmF0aW9uUmVjb3JkZXJzJyxcbiAgICAgICAgICAnY29uZmlnOkRlc2NyaWJlQ29uZmlndXJhdGlvblJlY29yZGVyU3RhdHVzJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFNlY3JldHMgTWFuYWdlciBhY2Nlc3MgZm9yIEFXUyBjcmVkZW50aWFsc1xuICAgIHRoaXMubWNwU2VydmVyVGFza1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzZWNyZXRzbWFuYWdlcjoke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259OiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OnNlY3JldDpoaXZlbWluZC9hd3Mtc2Nhbi1jcmVkZW50aWFscy0qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEJhc2UgcG9saWN5IGZvciBhbGwgYWdlbnRzIC0gYWNjZXNzIHRvIEJlZHJvY2sgYW5kIEtlbmRyYVxuICAgIGNvbnN0IGJlZHJvY2tLZW5kcmFQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgICAna2VuZHJhOlJldHJpZXZlJyxcbiAgICAgICAgJ2tlbmRyYTpRdWVyeScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KTtcblxuICAgIE9iamVjdC52YWx1ZXModGhpcy5hZ2VudFRhc2tSb2xlcykuZm9yRWFjaCgocm9sZSkgPT4ge1xuICAgICAgcm9sZS5hZGRUb1BvbGljeShiZWRyb2NrS2VuZHJhUG9saWN5KTtcbiAgICB9KTtcblxuICAgIC8vIFNlY3JldHMgTWFuYWdlciBhY2Nlc3MgZm9yIGFnZW50c1xuICAgIGNvbnN0IHNlY3JldHNNYW5hZ2VyUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydzZWNyZXRzbWFuYWdlcjpHZXRTZWNyZXRWYWx1ZSddLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6c2VjcmV0c21hbmFnZXI6JHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufToke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fTpzZWNyZXQ6aGl2ZW1pbmQvKmBdLFxuICAgIH0pO1xuXG4gICAgT2JqZWN0LnZhbHVlcyh0aGlzLmFnZW50VGFza1JvbGVzKS5mb3JFYWNoKChyb2xlKSA9PiB7XG4gICAgICByb2xlLmFkZFRvUG9saWN5KHNlY3JldHNNYW5hZ2VyUG9saWN5KTtcbiAgICB9KTtcblxuICAgIC8vIFgtUmF5IHRyYWNpbmcgZm9yIGFsbCBhZ2VudCByb2xlc1xuICAgIGNvbnN0IHhyYXlQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ3hyYXk6UHV0VHJhY2VTZWdtZW50cycsICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSk7XG5cbiAgICBPYmplY3QudmFsdWVzKHRoaXMuYWdlbnRUYXNrUm9sZXMpLmZvckVhY2goKHJvbGUpID0+IHtcbiAgICAgIHJvbGUuYWRkVG9Qb2xpY3koeHJheVBvbGljeSk7XG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09IExBTUJEQSBFWEVDVVRJT04gUk9MRVMgPT09PT09PT09PVxuICAgIFxuICAgIC8vIENyZWF0ZSBMYW1iZGEgcm9sZXMgaGVyZSB0byBhdm9pZCBjeWNsaWMgZGVwZW5kZW5jeVxuICAgIGNvbnN0IHVucGFja0xhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1VucGFja0xhbWJkYVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIHJvbGVOYW1lOiAnSGl2ZW1pbmRVbnBhY2tMYW1iZGFSb2xlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGFtYmRhIGV4ZWN1dGlvbiByb2xlOiBVbnBhY2sgYW5kIHZhbGlkYXRlIHVwbG9hZGVkIGNvZGUnLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFWUENBY2Nlc3NFeGVjdXRpb25Sb2xlJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbWVtb3J5SW5nZXN0b3JMYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdNZW1vcnlJbmdlc3RvckxhbWJkYVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIHJvbGVOYW1lOiAnSGl2ZW1pbmRNZW1vcnlJbmdlc3RvclJvbGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZXhlY3V0aW9uIHJvbGU6IENyZWF0ZSBLZW5kcmEgbWVtb3J5IGRvY3VtZW50cycsXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBmYWlsdXJlSGFuZGxlckxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0ZhaWx1cmVIYW5kbGVyTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6ICdIaXZlbWluZEZhaWx1cmVIYW5kbGVyUm9sZScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0xhbWJkYSBleGVjdXRpb24gcm9sZTogSGFuZGxlIG1pc3Npb24gZmFpbHVyZXMnLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScpLFxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFWUENBY2Nlc3NFeGVjdXRpb25Sb2xlJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIFgtUmF5IHRvIExhbWJkYSByb2xlcyAocmV1c2Ugc2FtZSBwb2xpY3kgZnJvbSBhZ2VudCByb2xlcyBhYm92ZSlcbiAgICBbdW5wYWNrTGFtYmRhUm9sZSwgbWVtb3J5SW5nZXN0b3JMYW1iZGFSb2xlLCBmYWlsdXJlSGFuZGxlckxhbWJkYVJvbGVdLmZvckVhY2goKHJvbGUpID0+IHtcbiAgICAgIHJvbGUuYWRkVG9Qb2xpY3koeHJheVBvbGljeSk7XG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09IEVDUyBDTFVTVEVSID09PT09PT09PT1cbiAgICB0aGlzLmVjc0NsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgJ0hpdmVtaW5kQ2x1c3RlcicsIHtcbiAgICAgIGNsdXN0ZXJOYW1lOiAnSGl2ZW1pbmRQcmlzbScsXG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIGNvbnRhaW5lckluc2lnaHRzOiB0cnVlLFxuICAgICAgZW5hYmxlRmFyZ2F0ZUNhcGFjaXR5UHJvdmlkZXJzOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PSBBR0VOVCBUQVNLIERFRklOSVRJT05TID09PT09PT09PT1cbiAgICB0aGlzLmFnZW50VGFza0RlZmluaXRpb25zID0ge307XG5cbiAgICBjb25zdCBhZ2VudE5hbWVzID0gWydhcmNoYWVvbG9naXN0JywgJ3N0cmF0ZWdpc3QnLCAnY29vcmRpbmF0b3InLCAnc3ludGhlc2l6ZXInLCAnY3JpdGljJywgJ2FyY2hpdmlzdCddO1xuXG4gICAgYWdlbnROYW1lcy5mb3JFYWNoKChhZ2VudE5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHRhc2tEZWYgPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCBgJHthZ2VudE5hbWV9VGFza0RlZmAsIHtcbiAgICAgICAgZmFtaWx5OiBgaGl2ZW1pbmQtJHthZ2VudE5hbWV9LWFnZW50YCxcbiAgICAgICAgY3B1OiAxMDI0LCAvLyAxIHZDUFVcbiAgICAgICAgbWVtb3J5TGltaXRNaUI6IDIwNDgsIC8vIDJHQiBSQU1cbiAgICAgICAgdGFza1JvbGU6IHRoaXMuYWdlbnRUYXNrUm9sZXNbYWdlbnROYW1lXSxcbiAgICAgICAgZXhlY3V0aW9uUm9sZTogdGhpcy5jcmVhdGVFeGVjdXRpb25Sb2xlKGAke2FnZW50TmFtZX1FeGVjdXRpb25Sb2xlYCksXG4gICAgICB9KTtcblxuICAgICAgLy8gQWRkIGNvbnRhaW5lciAtIEVDUiByZXBvIG11c3QgZXhpc3QgYmVmb3JlIGRlcGxveW1lbnRcbiAgICAgIGNvbnN0IGVjclJlcG8gPSBlY3IuUmVwb3NpdG9yeS5mcm9tUmVwb3NpdG9yeU5hbWUodGhpcywgYCR7YWdlbnROYW1lfUVjclJlcG9gLCBgaGl2ZW1pbmQtJHthZ2VudE5hbWV9YCk7XG4gICAgICBjb25zdCBjb250YWluZXIgPSB0YXNrRGVmLmFkZENvbnRhaW5lcihgJHthZ2VudE5hbWV9Q29udGFpbmVyYCwge1xuICAgICAgICBjb250YWluZXJOYW1lOiBgJHthZ2VudE5hbWV9LWFnZW50YCxcbiAgICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShlY3JSZXBvLCAnbGF0ZXN0JyksXG4gICAgICAgIGxvZ2dpbmc6IGVjcy5Mb2dEcml2ZXIuYXdzTG9ncyh7XG4gICAgICAgICAgc3RyZWFtUHJlZml4OiBhZ2VudE5hbWUsXG4gICAgICAgICAgbG9nR3JvdXA6IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIGAke2FnZW50TmFtZX1Mb2dHcm91cGAsIHtcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9lY3MvJHthZ2VudE5hbWV9LWFnZW50YCxcbiAgICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBTM19BUlRJRkFDVFNfQlVDS0VUOiBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBTM19LRU5EUkFfQlVDS0VUOiBwcm9wcy5rZW5kcmFCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBEWU5BTU9EQl9NSVNTSU9OX1RBQkxFOiBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIERZTkFNT0RCX1RPT0xfUkVTVUxUU19UQUJMRTogcHJvcHMudG9vbFJlc3VsdHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgRFlOQU1PREJfRklORElOR1NfVEFCTEU6IHByb3BzLmZpbmRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIFJFRElTX0VORFBPSU5UOiBwcm9wcy5lbGFzdGlDYWNoZUNsdXN0ZXIuYXR0clJlZGlzRW5kcG9pbnRBZGRyZXNzLFxuICAgICAgICAgIFJFRElTX1BPUlQ6IHByb3BzLmVsYXN0aUNhY2hlQ2x1c3Rlci5hdHRyUmVkaXNFbmRwb2ludFBvcnQsXG4gICAgICAgICAgS0VORFJBX0lOREVYX0lEOiBwcm9wcy5rZW5kcmFJbmRleC5hdHRySWQsXG4gICAgICAgICAgQkVEUk9DS19NT0RFTF9JRDogJ2FudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJyxcbiAgICAgICAgICBBR0VOVF9OQU1FOiBhZ2VudE5hbWUsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgdGhpcy5hZ2VudFRhc2tEZWZpbml0aW9uc1thZ2VudE5hbWVdID0gdGFza0RlZjtcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIGFsbCBhZ2VudCByb2xlc1xuICAgIE9iamVjdC52YWx1ZXModGhpcy5hZ2VudFRhc2tSb2xlcykuZm9yRWFjaCgocm9sZSkgPT4ge1xuICAgICAgcHJvcHMuYXJ0aWZhY3RzQnVja2V0LmdyYW50UmVhZFdyaXRlKHJvbGUpO1xuICAgICAgcHJvcHMudXBsb2Fkc0J1Y2tldC5ncmFudFJlYWQocm9sZSk7XG4gICAgICBwcm9wcy5rZW5kcmFCdWNrZXQuZ3JhbnRSZWFkV3JpdGUocm9sZSk7XG4gICAgICBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJvbGUpO1xuICAgICAgcHJvcHMudG9vbFJlc3VsdHNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocm9sZSk7XG4gICAgICBwcm9wcy5maW5kaW5nc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyb2xlKTtcbiAgICAgIHByb3BzLmttc0tleS5ncmFudERlY3J5cHQocm9sZSk7XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgRWxhc3RpQ2FjaGUgcGVybWlzc2lvbnMgZm9yIGFnZW50c1xuICAgIGNvbnN0IGVsYXN0aUNhY2hlUG9saWN5ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZWxhc3RpY2FjaGU6RGVzY3JpYmVDYWNoZUNsdXN0ZXJzJyxcbiAgICAgICAgJ2VsYXN0aWNhY2hlOkRlc2NyaWJlUmVwbGljYXRpb25Hcm91cHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSk7XG5cbiAgICBPYmplY3QudmFsdWVzKHRoaXMuYWdlbnRUYXNrUm9sZXMpLmZvckVhY2goKHJvbGUpID0+IHtcbiAgICAgIHJvbGUuYWRkVG9Qb2xpY3koZWxhc3RpQ2FjaGVQb2xpY3kpO1xuICAgIH0pO1xuXG4gICAgLy8gQ0xJIHBlcm1pc3Npb25zIGFyZSBncmFudGVkIHZpYSBJQU0gcG9saWN5IGluIFNlY3VyaXR5IHN0YWNrIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY3lcblxuICAgIC8vID09PT09PT09PT0gTUNQIFRPT0wgVEFTSyBERUZJTklUSU9OUyA9PT09PT09PT09XG4gICAgdGhpcy5tY3BUYXNrRGVmaW5pdGlvbnMgPSB7fTtcblxuICAgIC8vIENvZGUgc2Nhbm5pbmcgdG9vbHNcbiAgICBjb25zdCBtY3BUb29scyA9IFsnc2VtZ3JlcC1tY3AnLCAnZ2l0bGVha3MtbWNwJywgJ3RyaXZ5LW1jcCcsICdzY291dHN1aXRlLW1jcCcsICdwYWN1LW1jcCddO1xuXG4gICAgbWNwVG9vbHMuZm9yRWFjaCgodG9vbE5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHRhc2tEZWYgPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCBgJHt0b29sTmFtZX1UYXNrRGVmYCwge1xuICAgICAgICBmYW1pbHk6IGBoaXZlbWluZC0ke3Rvb2xOYW1lfWAsXG4gICAgICAgIGNwdTogMjA0OCwgLy8gMiB2Q1BVIGZvciBpbnRlbnNpdmUgc2Nhbm5pbmdcbiAgICAgICAgbWVtb3J5TGltaXRNaUI6IDQwOTYsIC8vIDRHQiBSQU1cbiAgICAgICAgdGFza1JvbGU6IHRoaXMubWNwU2VydmVyVGFza1JvbGUsXG4gICAgICAgIGV4ZWN1dGlvblJvbGU6IHRoaXMuY3JlYXRlRXhlY3V0aW9uUm9sZShgJHt0b29sTmFtZX1FeGVjdXRpb25Sb2xlYCksXG4gICAgICB9KTtcblxuICAgICAgLy8gRUNSIHJlcG8gbXVzdCBleGlzdCBiZWZvcmUgZGVwbG95bWVudFxuICAgICAgY29uc3QgZWNyUmVwbyA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZSh0aGlzLCBgJHt0b29sTmFtZX1FY3JSZXBvYCwgdG9vbE5hbWUpO1xuICAgICAgY29uc3QgY29udGFpbmVyID0gdGFza0RlZi5hZGRDb250YWluZXIoYCR7dG9vbE5hbWV9Q29udGFpbmVyYCwge1xuICAgICAgICBjb250YWluZXJOYW1lOiB0b29sTmFtZSxcbiAgICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShlY3JSZXBvLCAnbGF0ZXN0JyksXG4gICAgICAgIGxvZ2dpbmc6IGVjcy5Mb2dEcml2ZXIuYXdzTG9ncyh7XG4gICAgICAgICAgc3RyZWFtUHJlZml4OiB0b29sTmFtZSxcbiAgICAgICAgICBsb2dHcm91cDogbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgYCR7dG9vbE5hbWV9TG9nR3JvdXBgLCB7XG4gICAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvZWNzLyR7dG9vbE5hbWV9YCxcbiAgICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBTM19BUlRJRkFDVFNfQlVDS0VUOiBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBEWU5BTU9EQl9UT09MX1JFU1VMVFNfVEFCTEU6IHByb3BzLnRvb2xSZXN1bHRzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIFRPT0xfTkFNRTogdG9vbE5hbWUsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgKHJlYWQtb25seSBjb2RlLCB3cml0ZS1vbmx5IHJlc3VsdHMpXG4gICAgICBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuZ3JhbnRSZWFkKHRoaXMubWNwU2VydmVyVGFza1JvbGUsICd1bnppcHBlZC8qJyk7XG4gICAgICBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuZ3JhbnRXcml0ZSh0aGlzLm1jcFNlcnZlclRhc2tSb2xlLCBgdG9vbC1yZXN1bHRzLyR7dG9vbE5hbWV9LypgKTtcbiAgICAgIHByb3BzLnRvb2xSZXN1bHRzVGFibGUuZ3JhbnRXcml0ZURhdGEodGhpcy5tY3BTZXJ2ZXJUYXNrUm9sZSk7XG5cbiAgICAgIHRoaXMubWNwVGFza0RlZmluaXRpb25zW3Rvb2xOYW1lXSA9IHRhc2tEZWY7XG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09IExBTUJEQSBGVU5DVElPTlMgPT09PT09PT09PVxuXG4gICAgLy8gVW5wYWNrIExhbWJkYVxuICAgIHRoaXMudW5wYWNrTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVW5wYWNrTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnSGl2ZW1pbmRVbnBhY2tBbmRWYWxpZGF0ZScsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMixcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnc3JjL2xhbWJkYXMvdW5wYWNrJyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIHJvbGU6IHVucGFja0xhbWJkYVJvbGUsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBVUExPQURTX0JVQ0tFVDogcHJvcHMudXBsb2Fkc0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBBUlRJRkFDVFNfQlVDS0VUOiBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgTUlTU0lPTl9UQUJMRTogcHJvcHMubWlzc2lvblN0YXR1c1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCB9LFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uc1xuICAgIHByb3BzLnVwbG9hZHNCdWNrZXQuZ3JhbnRSZWFkKHVucGFja0xhbWJkYVJvbGUpO1xuICAgIHByb3BzLmFydGlmYWN0c0J1Y2tldC5ncmFudFJlYWRXcml0ZSh1bnBhY2tMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHVucGFja0xhbWJkYVJvbGUpO1xuICAgIHByb3BzLmttc0tleS5ncmFudERlY3J5cHQodW5wYWNrTGFtYmRhUm9sZSk7XG5cbiAgICAvLyBNZW1vcnkgSW5nZXN0b3IgTGFtYmRhXG4gICAgdGhpcy5tZW1vcnlJbmdlc3RvckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ01lbW9yeUluZ2VzdG9yTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnSGl2ZW1pbmRNZW1vcnlJbmdlc3RvcicsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMixcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnc3JjL2xhbWJkYXMvbWVtb3J5X2luZ2VzdG9yJyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygyKSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHJvbGU6IG1lbW9yeUluZ2VzdG9yTGFtYmRhUm9sZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEZJTkRJTkdTX1RBQkxFOiBwcm9wcy5maW5kaW5nc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgS0VORFJBX0JVQ0tFVDogcHJvcHMua2VuZHJhQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIEtFTkRSQV9JTkRFWF9JRDogcHJvcHMua2VuZHJhSW5kZXguYXR0cklkLFxuICAgICAgfSxcbiAgICAgIHZwYzogcHJvcHMudnBjLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEIH0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXG4gICAgcHJvcHMuZmluZGluZ3NUYWJsZS5ncmFudFJlYWREYXRhKG1lbW9yeUluZ2VzdG9yTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMua2VuZHJhQnVja2V0LmdyYW50V3JpdGUobWVtb3J5SW5nZXN0b3JMYW1iZGFSb2xlKTtcbiAgICBtZW1vcnlJbmdlc3RvckxhbWJkYVJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsna2VuZHJhOkJhdGNoUHV0RG9jdW1lbnQnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbcHJvcHMua2VuZHJhSW5kZXguYXR0ckFybl0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBGYWlsdXJlIEhhbmRsZXIgTGFtYmRhXG4gICAgdGhpcy5mYWlsdXJlSGFuZGxlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0ZhaWx1cmVIYW5kbGVyTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnSGl2ZW1pbmRGYWlsdXJlSGFuZGxlcicsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMixcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnc3JjL2xhbWJkYXMvZmFpbHVyZV9oYW5kbGVyJyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgIG1lbW9yeVNpemU6IDEyOCxcbiAgICAgIHJvbGU6IGZhaWx1cmVIYW5kbGVyTGFtYmRhUm9sZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIE1JU1NJT05fVEFCTEU6IHByb3BzLm1pc3Npb25TdGF0dXNUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgdnBjOiBwcm9wcy52cGMsXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGZhaWx1cmVIYW5kbGVyTGFtYmRhUm9sZSk7XG5cbiAgICAvLyA9PT09PT09PT09IE9VVFBVVFMgPT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Vjc0NsdXN0ZXJOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZWNzQ2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIENsdXN0ZXIgbmFtZScsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1FY3NDbHVzdGVyJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVbnBhY2tMYW1iZGFBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy51bnBhY2tMYW1iZGEuZnVuY3Rpb25Bcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1VucGFjayBMYW1iZGEgQVJOJyxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlRXhlY3V0aW9uUm9sZShpZDogc3RyaW5nKTogaWFtLlJvbGUge1xuICAgIGNvbnN0IHJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgaWQsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FtYXpvbkVDU1Rhc2tFeGVjdXRpb25Sb2xlUG9saWN5JyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEVDUiBwZXJtaXNzaW9uc1xuICAgIHJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbicsXG4gICAgICAgICAgJ2VjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHknLFxuICAgICAgICAgICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsXG4gICAgICAgICAgJ2VjcjpCYXRjaEdldEltYWdlJyxcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHJldHVybiByb2xlO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVBZ2VudFJvbGUoYWdlbnROYW1lOiBzdHJpbmcsIGRlc2NyaXB0aW9uOiBzdHJpbmcpOiBpYW0uUm9sZSB7XG4gICAgcmV0dXJuIG5ldyBpYW0uUm9sZSh0aGlzLCBgJHthZ2VudE5hbWV9VGFza1JvbGVgLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWNzLXRhc2tzLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIHJvbGVOYW1lOiBgSGl2ZW1pbmQke2FnZW50TmFtZX1UYXNrUm9sZWAsXG4gICAgICBkZXNjcmlwdGlvbjogYEVDUyB0YXNrIHJvbGUgZm9yICR7YWdlbnROYW1lfSBhZ2VudDogJHtkZXNjcmlwdGlvbn1gLFxuICAgIH0pO1xuICB9XG59Il19