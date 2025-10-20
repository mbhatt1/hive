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
            description: 'Role for MCP tool server tasks (read-only code access)',
        });
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
            // Add container
            const container = taskDef.addContainer(`${agentName}Container`, {
                containerName: `${agentName}-agent`,
                image: ecs.ContainerImage.fromRegistry(`${cdk.Stack.of(this).account}.dkr.ecr.${cdk.Stack.of(this).region}.amazonaws.com/hivemind-${agentName}:latest`),
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
                    BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-4-20250514-v1:0',
                    AGENT_NAME: agentName,
                },
            });
            // Grant permissions
            props.artifactsBucket.grantRead(this.agentTaskRoles[agentName]);
            props.artifactsBucket.grantWrite(this.agentTaskRoles[agentName], `agent-outputs/${agentName}/*`);
            props.kendraBucket.grantRead(this.agentTaskRoles[agentName]);
            props.missionStatusTable.grantReadWriteData(this.agentTaskRoles[agentName]);
            props.toolResultsTable.grantReadData(this.agentTaskRoles[agentName]);
            props.findingsTable.grantReadWriteData(this.agentTaskRoles[agentName]);
            this.agentTaskDefinitions[agentName] = taskDef;
        });
        // ========== MCP TOOL TASK DEFINITIONS ==========
        this.mcpTaskDefinitions = {};
        const mcpTools = ['semgrep-mcp', 'gitleaks-mcp', 'trivy-mcp'];
        mcpTools.forEach((toolName) => {
            const taskDef = new ecs.FargateTaskDefinition(this, `${toolName}TaskDef`, {
                family: `hivemind-${toolName}`,
                cpu: 2048, // 2 vCPU for intensive scanning
                memoryLimitMiB: 4096, // 4GB RAM
                taskRole: this.mcpServerTaskRole,
                executionRole: this.createExecutionRole(`${toolName}ExecutionRole`),
            });
            const container = taskDef.addContainer(`${toolName}Container`, {
                containerName: toolName,
                image: ecs.ContainerImage.fromRegistry(`${cdk.Stack.of(this).account}.dkr.ecr.${cdk.Stack.of(this).region}.amazonaws.com/${toolName}:latest`),
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
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
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
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
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
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcHV0ZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9jb21wdXRlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQywrREFBaUQ7QUFNakQsMkRBQTZDO0FBa0I3QyxNQUFhLFlBQWEsU0FBUSxHQUFHLENBQUMsS0FBSztJQVV6QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXdCO1FBQ2hFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLHlDQUF5QztRQUN6QyxvRkFBb0Y7UUFDcEYsSUFBSSxDQUFDLGNBQWMsR0FBRztZQUNwQixhQUFhLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxlQUFlLEVBQUUsMkNBQTJDLENBQUM7WUFDakcsVUFBVSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsWUFBWSxFQUFFLDZCQUE2QixDQUFDO1lBQzdFLFdBQVcsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLGFBQWEsRUFBRSxvQ0FBb0MsQ0FBQztZQUN0RixXQUFXLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxhQUFhLEVBQUUsc0NBQXNDLENBQUM7WUFDeEYsTUFBTSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsUUFBUSxFQUFFLGtDQUFrQyxDQUFDO1lBQzFFLFNBQVMsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRSxvQ0FBb0MsQ0FBQztTQUNuRixDQUFDO1FBRUYsdUJBQXVCO1FBQ3ZCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQy9ELFNBQVMsRUFBRSxJQUFJLEdB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QXlCLENBQUM7WUFDOUQsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsK0NBQStDLENBQUM7YUFDNUY7U0FDRixDQUFDLENBQUM7UUFFSCxzQkFBc0I7UUFDdEIsSUFBSSxDQUFDLFdBQVcsQ0FDZCxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsT0FBTyxFQUFFO2dCQUNQLDJCQUEyQjtnQkFDM0IsaUNBQWlDO2dCQUNqQyw0QkFBNEI7Z0JBQzVCLG1CQUFtQjthQUNwQjtZQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztTQUNqQixDQUFDLENBQ0gsQ0FBQztRQUVGLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVPLGVBQWUsQ0FBQyxTQUFpQixFQUFFLFdBQW1CO1FBQzVELE9BQU8sSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxHQUFHLFNBQVMsVUFBVSxFQUFFO1lBQ2hELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyx5QkFBeUIsQ0FBQztZQUM5RCxRQUFRLEVBQUUsV0FBVyxTQUFTLFVBQVU7WUFDeEMsV0FBVyxFQUFFLHFCQUFxQixTQUFTLFdBQVcsV0FBVyxFQUFFO1NBQ3BFLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdVRCxvQ0E2VUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgKiBhcyBlbGFzdGljYWNoZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2FjaGUnO1xuaW1wb3J0ICogYXMga2VuZHJhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rZW5kcmEnO1xuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBDb21wdXRlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdnBjOiBlYzIuVnBjO1xuICBhZ2VudFNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBtY3BUb29sc1NlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICB1cGxvYWRzQnVja2V0OiBzMy5CdWNrZXQ7XG4gIGFydGlmYWN0c0J1Y2tldDogczMuQnVja2V0O1xuICBrZW5kcmFCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgbWlzc2lvblN0YXR1c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgdG9vbFJlc3VsdHNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIGZpbmRpbmdzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBlbGFzdGlDYWNoZUNsdXN0ZXI6IGVsYXN0aWNhY2hlLkNmbkNhY2hlQ2x1c3RlcjtcbiAga2VuZHJhSW5kZXg6IGtlbmRyYS5DZm5JbmRleDtcbiAga21zS2V5OiBrbXMuS2V5O1xufVxuXG5leHBvcnQgY2xhc3MgQ29tcHV0ZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGVjc0NsdXN0ZXI6IGVjcy5DbHVzdGVyO1xuICBwdWJsaWMgcmVhZG9ubHkgYWdlbnRUYXNrRGVmaW5pdGlvbnM6IHsgW2tleTogc3RyaW5nXTogZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbiB9O1xuICBwdWJsaWMgcmVhZG9ubHkgbWNwVGFza0RlZmluaXRpb25zOiB7IFtrZXk6IHN0cmluZ106IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24gfTtcbiAgcHVibGljIHJlYWRvbmx5IHVucGFja0xhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgbWVtb3J5SW5nZXN0b3JMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IGZhaWx1cmVIYW5kbGVyTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBhZ2VudFRhc2tSb2xlczogeyBba2V5OiBzdHJpbmddOiBpYW0uUm9sZSB9O1xuICBwdWJsaWMgcmVhZG9ubHkgbWNwU2VydmVyVGFza1JvbGU6IGlhbS5Sb2xlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb21wdXRlU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PSBBR0VOVCBUQVNLIFJPTEVTID09PT09PT09PT1cbiAgICAvLyBDcmVhdGUgYWdlbnQgcm9sZXMgaGVyZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5IHdpdGggU2VjdXJpdHkvU3RvcmFnZSBzdGFja3NcbiAgICB0aGlzLmFnZW50VGFza1JvbGVzID0ge1xuICAgICAgYXJjaGFlb2xvZ2lzdDogdGhpcy5jcmVhdGVBZ2VudFJvbGUoJ0FyY2hhZW9sb2dpc3QnLCAnQ29udGV4dCBkaXNjb3ZlcnkgYW5kIG1ldGFkYXRhIGV4dHJhY3Rpb24nKSxcbiAgICAgIHN0cmF0ZWdpc3Q6IHRoaXMuY3JlYXRlQWdlbnRSb2xlKCdTdHJhdGVnaXN0JywgJ1BsYW5uaW5nIGFuZCB0b29sIHNlbGVjdGlvbicpLFxuICAgICAgY29vcmRpbmF0b3I6IHRoaXMuY3JlYXRlQWdlbnRSb2xlKCdDb29yZGluYXRvcicsICdSZXNvdXJjZSBhbGxvY2F0aW9uIGFuZCBzY2hlZHVsaW5nJyksXG4gICAgICBzeW50aGVzaXplcjogdGhpcy5jcmVhdGVBZ2VudFJvbGUoJ1N5bnRoZXNpemVyJywgJ0ZpbmRpbmcgZ2VuZXJhdGlvbiBmcm9tIHRvb2wgcmVzdWx0cycpLFxuICAgICAgY3JpdGljOiB0aGlzLmNyZWF0ZUFnZW50Um9sZSgnQ3JpdGljJywgJ0ZpbmRpbmcgdmFsaWRhdGlvbiBhbmQgY2hhbGxlbmdlJyksXG4gICAgICBhcmNoaXZpc3Q6IHRoaXMuY3JlYXRlQWdlbnRSb2xlKCdBcmNoaXZpc3QnLCAnRmluYWwgc3RvcmFnZSBhbmQgbWVtb3J5IGZvcm1hdGlvbicpLFxuICAgIH07XG5cbiAgICAvLyBNQ1AgU2VydmVyIFRhc2sgUm9sZVxuICAgIHRoaXMubWNwU2VydmVyVGFza1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ01jcFNlcnZlclRhc2tSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICByb2xlTmFtZTogJ0hpdmVtaW5kTWNwU2VydmVyVGFza1JvbGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdSb2xlIGZvciBNQ1AgdG9vbCBzZXJ2ZXIgdGFza3MgKHJlYWQtb25seSBjb2RlIGFjY2VzcyknLFxuICAgIH0pO1xuXG4gICAgLy8gQmFzZSBwb2xpY3kgZm9yIGFsbCBhZ2VudHMgLSBhY2Nlc3MgdG8gQmVkcm9jayBhbmQgS2VuZHJhXG4gICAgY29uc3QgYmVkcm9ja0tlbmRyYVBvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXG4gICAgICAgICdrZW5kcmE6UmV0cmlldmUnLFxuICAgICAgICAna2VuZHJhOlF1ZXJ5JyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pO1xuXG4gICAgT2JqZWN0LnZhbHVlcyh0aGlzLmFnZW50VGFza1JvbGVzKS5mb3JFYWNoKChyb2xlKSA9PiB7XG4gICAgICByb2xlLmFkZFRvUG9saWN5KGJlZHJvY2tLZW5kcmFQb2xpY3kpO1xuICAgIH0pO1xuXG4gICAgLy8gU2VjcmV0cyBNYW5hZ2VyIGFjY2VzcyBmb3IgYWdlbnRzXG4gICAgY29uc3Qgc2VjcmV0c01hbmFnZXJQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpzZWNyZXRzbWFuYWdlcjoke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259OiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OnNlY3JldDpoaXZlbWluZC8qYF0sXG4gICAgfSk7XG5cbiAgICBPYmplY3QudmFsdWVzKHRoaXMuYWdlbnRUYXNrUm9sZXMpLmZvckVhY2goKHJvbGUpID0+IHtcbiAgICAgIHJvbGUuYWRkVG9Qb2xpY3koc2VjcmV0c01hbmFnZXJQb2xpY3kpO1xuICAgIH0pO1xuXG4gICAgLy8gWC1SYXkgdHJhY2luZyBmb3IgYWxsIGFnZW50IHJvbGVzXG4gICAgY29uc3QgeHJheVBvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsneHJheTpQdXRUcmFjZVNlZ21lbnRzJywgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcyddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KTtcblxuICAgIE9iamVjdC52YWx1ZXModGhpcy5hZ2VudFRhc2tSb2xlcykuZm9yRWFjaCgocm9sZSkgPT4ge1xuICAgICAgcm9sZS5hZGRUb1BvbGljeSh4cmF5UG9saWN5KTtcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gTEFNQkRBIEVYRUNVVElPTiBST0xFUyA9PT09PT09PT09XG4gICAgXG4gICAgLy8gQ3JlYXRlIExhbWJkYSByb2xlcyBoZXJlIHRvIGF2b2lkIGN5Y2xpYyBkZXBlbmRlbmN5XG4gICAgY29uc3QgdW5wYWNrTGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnVW5wYWNrTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6ICdIaXZlbWluZFVucGFja0xhbWJkYVJvbGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZXhlY3V0aW9uIHJvbGU6IFVucGFjayBhbmQgdmFsaWRhdGUgdXBsb2FkZWQgY29kZScsXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBtZW1vcnlJbmdlc3RvckxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ01lbW9yeUluZ2VzdG9yTGFtYmRhUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6ICdIaXZlbWluZE1lbW9yeUluZ2VzdG9yUm9sZScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0xhbWJkYSBleGVjdXRpb24gcm9sZTogQ3JlYXRlIEtlbmRyYSBtZW1vcnkgZG9jdW1lbnRzJyxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGZhaWx1cmVIYW5kbGVyTGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRmFpbHVyZUhhbmRsZXJMYW1iZGFSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICByb2xlTmFtZTogJ0hpdmVtaW5kRmFpbHVyZUhhbmRsZXJSb2xlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGFtYmRhIGV4ZWN1dGlvbiByb2xlOiBIYW5kbGUgbWlzc2lvbiBmYWlsdXJlcycsXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgWC1SYXkgdG8gTGFtYmRhIHJvbGVzIChyZXVzZSBzYW1lIHBvbGljeSBmcm9tIGFnZW50IHJvbGVzIGFib3ZlKVxuICAgIFt1bnBhY2tMYW1iZGFSb2xlLCBtZW1vcnlJbmdlc3RvckxhbWJkYVJvbGUsIGZhaWx1cmVIYW5kbGVyTGFtYmRhUm9sZV0uZm9yRWFjaCgocm9sZSkgPT4ge1xuICAgICAgcm9sZS5hZGRUb1BvbGljeSh4cmF5UG9saWN5KTtcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gRUNTIENMVVNURVIgPT09PT09PT09PVxuICAgIHRoaXMuZWNzQ2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnSGl2ZW1pbmRDbHVzdGVyJywge1xuICAgICAgY2x1c3Rlck5hbWU6ICdIaXZlbWluZFByaXNtJyxcbiAgICAgIHZwYzogcHJvcHMudnBjLFxuICAgICAgY29udGFpbmVySW5zaWdodHM6IHRydWUsXG4gICAgICBlbmFibGVGYXJnYXRlQ2FwYWNpdHlQcm92aWRlcnM6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09IEFHRU5UIFRBU0sgREVGSU5JVElPTlMgPT09PT09PT09PVxuICAgIHRoaXMuYWdlbnRUYXNrRGVmaW5pdGlvbnMgPSB7fTtcblxuICAgIGNvbnN0IGFnZW50TmFtZXMgPSBbJ2FyY2hhZW9sb2dpc3QnLCAnc3RyYXRlZ2lzdCcsICdjb29yZGluYXRvcicsICdzeW50aGVzaXplcicsICdjcml0aWMnLCAnYXJjaGl2aXN0J107XG5cbiAgICBhZ2VudE5hbWVzLmZvckVhY2goKGFnZW50TmFtZSkgPT4ge1xuICAgICAgY29uc3QgdGFza0RlZiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsIGAke2FnZW50TmFtZX1UYXNrRGVmYCwge1xuICAgICAgICBmYW1pbHk6IGBoaXZlbWluZC0ke2FnZW50TmFtZX0tYWdlbnRgLFxuICAgICAgICBjcHU6IDEwMjQsIC8vIDEgdkNQVVxuICAgICAgICBtZW1vcnlMaW1pdE1pQjogMjA0OCwgLy8gMkdCIFJBTVxuICAgICAgICB0YXNrUm9sZTogdGhpcy5hZ2VudFRhc2tSb2xlc1thZ2VudE5hbWVdLFxuICAgICAgICBleGVjdXRpb25Sb2xlOiB0aGlzLmNyZWF0ZUV4ZWN1dGlvblJvbGUoYCR7YWdlbnROYW1lfUV4ZWN1dGlvblJvbGVgKSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBBZGQgY29udGFpbmVyXG4gICAgICBjb25zdCBjb250YWluZXIgPSB0YXNrRGVmLmFkZENvbnRhaW5lcihgJHthZ2VudE5hbWV9Q29udGFpbmVyYCwge1xuICAgICAgICBjb250YWluZXJOYW1lOiBgJHthZ2VudE5hbWV9LWFnZW50YCxcbiAgICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoXG4gICAgICAgICAgYCR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9LmRrci5lY3IuJHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufS5hbWF6b25hd3MuY29tL2hpdmVtaW5kLSR7YWdlbnROYW1lfTpsYXRlc3RgXG4gICAgICAgICksXG4gICAgICAgIGxvZ2dpbmc6IGVjcy5Mb2dEcml2ZXIuYXdzTG9ncyh7XG4gICAgICAgICAgc3RyZWFtUHJlZml4OiBhZ2VudE5hbWUsXG4gICAgICAgICAgbG9nR3JvdXA6IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIGAke2FnZW50TmFtZX1Mb2dHcm91cGAsIHtcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9lY3MvJHthZ2VudE5hbWV9LWFnZW50YCxcbiAgICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgQVdTX1JFR0lPTjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBTM19BUlRJRkFDVFNfQlVDS0VUOiBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBTM19LRU5EUkFfQlVDS0VUOiBwcm9wcy5rZW5kcmFCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgICBEWU5BTU9EQl9NSVNTSU9OX1RBQkxFOiBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIERZTkFNT0RCX1RPT0xfUkVTVUxUU19UQUJMRTogcHJvcHMudG9vbFJlc3VsdHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgRFlOQU1PREJfRklORElOR1NfVEFCTEU6IHByb3BzLmZpbmRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIFJFRElTX0VORFBPSU5UOiBwcm9wcy5lbGFzdGlDYWNoZUNsdXN0ZXIuYXR0clJlZGlzRW5kcG9pbnRBZGRyZXNzLFxuICAgICAgICAgIFJFRElTX1BPUlQ6IHByb3BzLmVsYXN0aUNhY2hlQ2x1c3Rlci5hdHRyUmVkaXNFbmRwb2ludFBvcnQsXG4gICAgICAgICAgS0VORFJBX0lOREVYX0lEOiBwcm9wcy5rZW5kcmFJbmRleC5hdHRySWQsXG4gICAgICAgICAgQkVEUk9DS19NT0RFTF9JRDogJ2FudGhyb3BpYy5jbGF1ZGUtc29ubmV0LTQtMjAyNTA1MTQtdjE6MCcsXG4gICAgICAgICAgQUdFTlRfTkFNRTogYWdlbnROYW1lLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXG4gICAgICBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuZ3JhbnRSZWFkKHRoaXMuYWdlbnRUYXNrUm9sZXNbYWdlbnROYW1lXSk7XG4gICAgICBwcm9wcy5hcnRpZmFjdHNCdWNrZXQuZ3JhbnRXcml0ZSh0aGlzLmFnZW50VGFza1JvbGVzW2FnZW50TmFtZV0sIGBhZ2VudC1vdXRwdXRzLyR7YWdlbnROYW1lfS8qYCk7XG4gICAgICBwcm9wcy5rZW5kcmFCdWNrZXQuZ3JhbnRSZWFkKHRoaXMuYWdlbnRUYXNrUm9sZXNbYWdlbnROYW1lXSk7XG4gICAgICBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMuYWdlbnRUYXNrUm9sZXNbYWdlbnROYW1lXSk7XG4gICAgICBwcm9wcy50b29sUmVzdWx0c1RhYmxlLmdyYW50UmVhZERhdGEodGhpcy5hZ2VudFRhc2tSb2xlc1thZ2VudE5hbWVdKTtcbiAgICAgIHByb3BzLmZpbmRpbmdzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMuYWdlbnRUYXNrUm9sZXNbYWdlbnROYW1lXSk7XG5cbiAgICAgIHRoaXMuYWdlbnRUYXNrRGVmaW5pdGlvbnNbYWdlbnROYW1lXSA9IHRhc2tEZWY7XG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09IE1DUCBUT09MIFRBU0sgREVGSU5JVElPTlMgPT09PT09PT09PVxuICAgIHRoaXMubWNwVGFza0RlZmluaXRpb25zID0ge307XG5cbiAgICBjb25zdCBtY3BUb29scyA9IFsnc2VtZ3JlcC1tY3AnLCAnZ2l0bGVha3MtbWNwJywgJ3RyaXZ5LW1jcCddO1xuXG4gICAgbWNwVG9vbHMuZm9yRWFjaCgodG9vbE5hbWUpID0+IHtcbiAgICAgIGNvbnN0IHRhc2tEZWYgPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCBgJHt0b29sTmFtZX1UYXNrRGVmYCwge1xuICAgICAgICBmYW1pbHk6IGBoaXZlbWluZC0ke3Rvb2xOYW1lfWAsXG4gICAgICAgIGNwdTogMjA0OCwgLy8gMiB2Q1BVIGZvciBpbnRlbnNpdmUgc2Nhbm5pbmdcbiAgICAgICAgbWVtb3J5TGltaXRNaUI6IDQwOTYsIC8vIDRHQiBSQU1cbiAgICAgICAgdGFza1JvbGU6IHRoaXMubWNwU2VydmVyVGFza1JvbGUsXG4gICAgICAgIGV4ZWN1dGlvblJvbGU6IHRoaXMuY3JlYXRlRXhlY3V0aW9uUm9sZShgJHt0b29sTmFtZX1FeGVjdXRpb25Sb2xlYCksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgY29udGFpbmVyID0gdGFza0RlZi5hZGRDb250YWluZXIoYCR7dG9vbE5hbWV9Q29udGFpbmVyYCwge1xuICAgICAgICBjb250YWluZXJOYW1lOiB0b29sTmFtZSxcbiAgICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tUmVnaXN0cnkoXG4gICAgICAgICAgYCR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9LmRrci5lY3IuJHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7dG9vbE5hbWV9OmxhdGVzdGBcbiAgICAgICAgKSxcbiAgICAgICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlci5hd3NMb2dzKHtcbiAgICAgICAgICBzdHJlYW1QcmVmaXg6IHRvb2xOYW1lLFxuICAgICAgICAgIGxvZ0dyb3VwOiBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBgJHt0b29sTmFtZX1Mb2dHcm91cGAsIHtcbiAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9lY3MvJHt0b29sTmFtZX1gLFxuICAgICAgICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9KSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBBV1NfUkVHSU9OOiBjZGsuU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgICAgIFMzX0FSVElGQUNUU19CVUNLRVQ6IHByb3BzLmFydGlmYWN0c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICAgIERZTkFNT0RCX1RPT0xfUkVTVUxUU19UQUJMRTogcHJvcHMudG9vbFJlc3VsdHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgVE9PTF9OQU1FOiB0b29sTmFtZSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyAocmVhZC1vbmx5IGNvZGUsIHdyaXRlLW9ubHkgcmVzdWx0cylcbiAgICAgIHByb3BzLmFydGlmYWN0c0J1Y2tldC5ncmFudFJlYWQodGhpcy5tY3BTZXJ2ZXJUYXNrUm9sZSwgJ3VuemlwcGVkLyonKTtcbiAgICAgIHByb3BzLmFydGlmYWN0c0J1Y2tldC5ncmFudFdyaXRlKHRoaXMubWNwU2VydmVyVGFza1JvbGUsIGB0b29sLXJlc3VsdHMvJHt0b29sTmFtZX0vKmApO1xuICAgICAgcHJvcHMudG9vbFJlc3VsdHNUYWJsZS5ncmFudFdyaXRlRGF0YSh0aGlzLm1jcFNlcnZlclRhc2tSb2xlKTtcblxuICAgICAgdGhpcy5tY3BUYXNrRGVmaW5pdGlvbnNbdG9vbE5hbWVdID0gdGFza0RlZjtcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gTEFNQkRBIEZVTkNUSU9OUyA9PT09PT09PT09XG5cbiAgICAvLyBVbnBhY2sgTGFtYmRhXG4gICAgdGhpcy51bnBhY2tMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdVbnBhY2tMYW1iZGEnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdIaXZlbWluZFVucGFja0FuZFZhbGlkYXRlJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEyLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdzcmMvbGFtYmRhcy91bnBhY2snKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgcm9sZTogdW5wYWNrTGFtYmRhUm9sZSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFVQTE9BRFNfQlVDS0VUOiBwcm9wcy51cGxvYWRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIEFSVElGQUNUU19CVUNLRVQ6IHByb3BzLmFydGlmYWN0c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBNSVNTSU9OX1RBQkxFOiBwcm9wcy5taXNzaW9uU3RhdHVzVGFibGUudGFibGVOYW1lLFxuICAgICAgfSxcbiAgICAgIHZwYzogcHJvcHMudnBjLFxuICAgICAgdnBjU3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXG4gICAgcHJvcHMudXBsb2Fkc0J1Y2tldC5ncmFudFJlYWQodW5wYWNrTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMuYXJ0aWZhY3RzQnVja2V0LmdyYW50UmVhZFdyaXRlKHVucGFja0xhbWJkYVJvbGUpO1xuICAgIHByb3BzLm1pc3Npb25TdGF0dXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodW5wYWNrTGFtYmRhUm9sZSk7XG4gICAgcHJvcHMua21zS2V5LmdyYW50RGVjcnlwdCh1bnBhY2tMYW1iZGFSb2xlKTtcblxuICAgIC8vIE1lbW9yeSBJbmdlc3RvciBMYW1iZGFcbiAgICB0aGlzLm1lbW9yeUluZ2VzdG9yTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWVtb3J5SW5nZXN0b3JMYW1iZGEnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdIaXZlbWluZE1lbW9yeUluZ2VzdG9yJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEyLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdzcmMvbGFtYmRhcy9tZW1vcnlfaW5nZXN0b3InKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDIpLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgcm9sZTogbWVtb3J5SW5nZXN0b3JMYW1iZGFSb2xlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRklORElOR1NfVEFCTEU6IHByb3BzLmZpbmRpbmdzVGFibGUudGFibGVOYW1lLFxuICAgICAgICBLRU5EUkFfQlVDS0VUOiBwcm9wcy5rZW5kcmFCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgS0VORFJBX0lOREVYX0lEOiBwcm9wcy5rZW5kcmFJbmRleC5hdHRySWQsXG4gICAgICB9LFxuICAgICAgdnBjOiBwcm9wcy52cGMsXG4gICAgICB2cGNTdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICBwcm9wcy5maW5kaW5nc1RhYmxlLmdyYW50UmVhZERhdGEobWVtb3J5SW5nZXN0b3JMYW1iZGFSb2xlKTtcbiAgICBwcm9wcy5rZW5kcmFCdWNrZXQuZ3JhbnRXcml0ZShtZW1vcnlJbmdlc3RvckxhbWJkYVJvbGUpO1xuICAgIG1lbW9yeUluZ2VzdG9yTGFtYmRhUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydrZW5kcmE6QmF0Y2hQdXREb2N1bWVudCddLFxuICAgICAgICByZXNvdXJjZXM6IFtwcm9wcy5rZW5kcmFJbmRleC5hdHRyQXJuXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEZhaWx1cmUgSGFuZGxlciBMYW1iZGFcbiAgICB0aGlzLmZhaWx1cmVIYW5kbGVyTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRmFpbHVyZUhhbmRsZXJMYW1iZGEnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6ICdIaXZlbWluZEZhaWx1cmVIYW5kbGVyJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEyLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdzcmMvbGFtYmRhcy9mYWlsdXJlX2hhbmRsZXInKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgbWVtb3J5U2l6ZTogMTI4LFxuICAgICAgcm9sZTogZmFpbHVyZUhhbmRsZXJMYW1iZGFSb2xlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTUlTU0lPTl9UQUJMRTogcHJvcHMubWlzc2lvblN0YXR1c1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIH0sXG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uc1xuICAgIHByb3BzLm1pc3Npb25TdGF0dXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZmFpbHVyZUhhbmRsZXJMYW1iZGFSb2xlKTtcblxuICAgIC8vID09PT09PT09PT0gT1VUUFVUUyA9PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRWNzQ2x1c3Rlck5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3NDbHVzdGVyLmNsdXN0ZXJOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgQ2x1c3RlciBuYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUVjc0NsdXN0ZXInLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VucGFja0xhbWJkYUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVucGFja0xhbWJkYS5mdW5jdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnVW5wYWNrIExhbWJkYSBBUk4nLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVFeGVjdXRpb25Sb2xlKGlkOiBzdHJpbmcpOiBpYW0uUm9sZSB7XG4gICAgY29uc3Qgcm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCBpZCwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgRUNSIHBlcm1pc3Npb25zXG4gICAgcm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdlY3I6R2V0QXV0aG9yaXphdGlvblRva2VuJyxcbiAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXG4gICAgICAgICAgJ2VjcjpHZXREb3dubG9hZFVybEZvckxheWVyJyxcbiAgICAgICAgICAnZWNyOkJhdGNoR2V0SW1hZ2UnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgcmV0dXJuIHJvbGU7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUFnZW50Um9sZShhZ2VudE5hbWU6IHN0cmluZywgZGVzY3JpcHRpb246IHN0cmluZyk6IGlhbS5Sb2xlIHtcbiAgICByZXR1cm4gbmV3IGlhbS5Sb2xlKHRoaXMsIGAke2FnZW50TmFtZX1UYXNrUm9sZWAsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6IGBIaXZlbWluZCR7YWdlbnROYW1lfVRhc2tSb2xlYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgRUNTIHRhc2sgcm9sZSBmb3IgJHthZ2VudE5hbWV9IGFnZW50OiAke2Rlc2NyaXB0aW9ufWAsXG4gICAgfSk7XG4gIH1cbn0iXX0=