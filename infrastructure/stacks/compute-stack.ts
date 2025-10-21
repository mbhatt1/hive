import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  agentSecurityGroup: ec2.SecurityGroup;
  mcpToolsSecurityGroup: ec2.SecurityGroup;
  uploadsBucket: s3.Bucket;
  artifactsBucket: s3.Bucket;
  kendraBucket: s3.Bucket;
  missionStatusTable: dynamodb.Table;
  toolResultsTable: dynamodb.Table;
  findingsTable: dynamodb.Table;
  elastiCacheCluster: elasticache.CfnCacheCluster;
  kendraIndex: kendra.CfnIndex;
  kmsKey: kms.Key;
}

export class ComputeStack extends cdk.Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly agentTaskDefinitions: { [key: string]: ecs.FargateTaskDefinition };
  public readonly mcpTaskDefinitions: { [key: string]: ecs.FargateTaskDefinition };
  public readonly unpackLambda: lambda.Function;
  public readonly memoryIngestorLambda: lambda.Function;
  public readonly failureHandlerLambda: lambda.Function;
  public readonly agentTaskRoles: { [key: string]: iam.Role };
  public readonly mcpServerTaskRole: iam.Role;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
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
    this.mcpServerTaskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('SecurityAudit')
    );

    // Additional permissions for ScoutSuite/Pacu AWS scanning
    this.mcpServerTaskRole.addToPolicy(
      new iam.PolicyStatement({
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
      })
    );

    // Secrets Manager access for AWS credentials
    this.mcpServerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:secret:hivemind/aws-scan-credentials-*`,
        ],
      })
    );

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
    memoryIngestorLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kendra:BatchPutDocument'],
        resources: [props.kendraIndex.attrArn],
      })
    );

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

  private createExecutionRole(id: string): iam.Role {
    const role = new iam.Role(this, id, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Add ECR permissions
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
        ],
        resources: ['*'],
      })
    );

    return role;
  }

  private createAgentRole(agentName: string, description: string): iam.Role {
    return new iam.Role(this, `${agentName}TaskRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      roleName: `Hivemind${agentName}TaskRole`,
      description: `ECS task role for ${agentName} agent: ${description}`,
    });
  }
}