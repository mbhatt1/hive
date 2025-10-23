import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface SecurityStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
}

export class SecurityStack extends cdk.Stack {
  public readonly kmsKey: kms.Key;
  public readonly agentSecurityGroup: ec2.SecurityGroup;
  public readonly mcpToolsSecurityGroup: ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly elastiCacheSecurityGroup: ec2.SecurityGroup;
  public readonly vpcEndpointsSecurityGroup: ec2.SecurityGroup;
  public readonly cliUserRole: iam.Role;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    // ========== KMS KEY ==========
    this.kmsKey = new kms.Key(this, 'HivemindKey', {
      enableKeyRotation: true,
      description: 'KMS key for Hivemind-Prism platform encryption',
      alias: 'alias/hivemind-platform',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pendingWindow: cdk.Duration.days(30),
    });

    // KMS key policies will be added by resource stacks to avoid circular dependencies

    // ========== SECURITY GROUPS ==========
    
    // VPC Endpoints Security Group
    this.vpcEndpointsSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointsSg', {
      vpc: props.vpc,
      description: 'Security group for VPC interface endpoints',
      allowAllOutbound: true,
    });

    // ElastiCache Security Group (create BEFORE agent SG that references it)
    this.elastiCacheSecurityGroup = new ec2.SecurityGroup(this, 'ElastiCacheSg', {
      vpc: props.vpc,
      description: 'Security group for ElastiCache Redis cluster',
      allowAllOutbound: false,
    });

    // Agent Tasks Security Group
    this.agentSecurityGroup = new ec2.SecurityGroup(this, 'AgentTasksSg', {
      vpc: props.vpc,
      description: 'Security group for AI agent Fargate tasks',
      allowAllOutbound: false,
    });

    // Allow agents to communicate with VPC endpoints
    this.agentSecurityGroup.addEgressRule(
      this.vpcEndpointsSecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS to VPC endpoints'
    );
    
    // Allow agents to connect to ElastiCache Redis
    this.agentSecurityGroup.addEgressRule(
      this.elastiCacheSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow agents to connect to Redis'
    );

    // MCP Tools Security Group
    this.mcpToolsSecurityGroup = new ec2.SecurityGroup(this, 'McpToolsSg', {
      vpc: props.vpc,
      description: 'Security group for MCP tool Fargate tasks',
      allowAllOutbound: false,
    });

    // Allow MCP tools to communicate with VPC endpoints
    this.mcpToolsSecurityGroup.addEgressRule(
      this.vpcEndpointsSecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS to VPC endpoints'
    );

    // Lambda Security Group
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: props.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: false,
    });

    // Allow Lambda to communicate with VPC endpoints
    this.lambdaSecurityGroup.addEgressRule(
      this.vpcEndpointsSecurityGroup,
      ec2.Port.tcp(443),
      'Allow HTTPS to VPC endpoints'
    );

    // Allow agents to access Redis (ingress rule for ElastiCache)
    this.elastiCacheSecurityGroup.addIngressRule(
      this.agentSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow agents to access Redis'
    );

    // Allow VPC endpoints to receive traffic from agent and MCP tasks
    this.vpcEndpointsSecurityGroup.addIngressRule(
      this.agentSecurityGroup,
      ec2.Port.tcp(443),
      'Allow agents to access endpoints'
    );

    this.vpcEndpointsSecurityGroup.addIngressRule(
      this.mcpToolsSecurityGroup,
      ec2.Port.tcp(443),
      'Allow MCP tools to access endpoints'
    );

    this.vpcEndpointsSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(443),
      'Allow Lambda functions to access endpoints'
    );

    // ========== IAM ROLES ==========

    // CLI User Role (AssumeRole target for developers/CI)
    this.cliUserRole = new iam.Role(this, 'HivemindCliUserRole', {
      assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${cdk.Stack.of(this).account}:root`),
      roleName: 'HivemindCliUserRole',
      description: 'Role assumed by developers and CI/CD to upload code',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Add KMS permissions for CLI role (allow all KMS keys in account for cross-region access)
    this.cliUserRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: [`arn:aws:kms:*:${cdk.Stack.of(this).account}:key/*`],
      })
    );

    // Add S3 and DynamoDB permissions using ARN patterns to avoid circular dependencies
    this.cliUserRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutObject',
          's3:PutObjectAcl',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ],
        resources: [`arn:aws:s3:::hivemind-uploads-${cdk.Stack.of(this).account}/uploads/*`],
      })
    );

    this.cliUserRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:PutItem',
          'dynamodb:GetItem',
          'dynamodb:UpdateItem',
          'dynamodb:Query',
        ],
        resources: [
          `arn:aws:dynamodb:*:${cdk.Stack.of(this).account}:table/HivemindMissionStatus-${cdk.Stack.of(this).account}`,
          `arn:aws:dynamodb:*:${cdk.Stack.of(this).account}:table/HivemindMissionStatus`,
        ],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'KmsKeyId', {
      value: this.kmsKey.keyId,
      description: 'KMS Key ID for platform encryption',
      exportName: 'HivemindPrism-KmsKeyId',
    });

    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: this.kmsKey.keyArn,
      description: 'KMS Key ARN',
      exportName: 'HivemindPrism-KmsKeyArn',
    });

    new cdk.CfnOutput(this, 'CliUserRoleArn', {
      value: this.cliUserRole.roleArn,
      description: 'CLI User Role ARN for AssumeRole',
      exportName: 'HivemindPrism-CliUserRoleArn',
    });
  }
}