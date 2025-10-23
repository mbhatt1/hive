#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../infrastructure/stacks/network-stack';
import { SecurityStack } from '../infrastructure/stacks/security-stack';
import { StorageStack } from '../infrastructure/stacks/storage-stack';
import { ComputeStack } from '../infrastructure/stacks/compute-stack';
import { IntelligenceStack } from '../infrastructure/stacks/intelligence-stack';
import { OrchestrationStack } from '../infrastructure/stacks/orchestration-stack';

const app = new cdk.App();

// Environment configuration with validation
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

if (!account) {
  throw new Error('AWS account ID must be provided via CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable');
}

const env = {
  account,
  region,
};

// Stack name prefix
const stackPrefix = 'HivemindPrism';

// Network Stack - VPC, Subnets, Endpoints
const networkStack = new NetworkStack(app, `${stackPrefix}-Network`, {
  env,
  description: 'Hivemind-Prism Network Infrastructure - VPC, Subnets, and VPC Endpoints',
  tags: {
    Project: 'Hivemind-Prism',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});

// Security Stack - KMS, IAM Roles, Security Groups
const securityStack = new SecurityStack(app, `${stackPrefix}-Security`, {
  env,
  description: 'Hivemind-Prism Security Infrastructure - KMS, IAM, and Security Groups',
  vpc: networkStack.vpc,
  tags: {
    Project: 'Hivemind-Prism',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});
securityStack.addDependency(networkStack);

// Storage Stack - S3 Buckets, DynamoDB Tables, ElastiCache
const storageStack = new StorageStack(app, `${stackPrefix}-Storage`, {
  env,
  description: 'Hivemind-Prism Storage Infrastructure - S3, DynamoDB, and ElastiCache',
  vpc: networkStack.vpc,
  kmsKey: securityStack.kmsKey,
  elastiCacheSecurityGroup: securityStack.elastiCacheSecurityGroup,
  tags: {
    Project: 'Hivemind-Prism',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});
storageStack.addDependency(securityStack);

// Intelligence Stack - Bedrock, Kendra
const intelligenceStack = new IntelligenceStack(app, `${stackPrefix}-Intelligence`, {
  env,
  description: 'Hivemind-Prism Intelligence Infrastructure - Bedrock and Kendra',
  kendraBucket: storageStack.kendraBucket,
  kmsKey: securityStack.kmsKey,
  tags: {
    Project: 'Hivemind-Prism',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});
intelligenceStack.addDependency(storageStack);

// Compute Stack - ECS Cluster, Fargate Task Definitions, Lambda Functions
const computeStack = new ComputeStack(app, `${stackPrefix}-Compute`, {
  env,
  description: 'Hivemind-Prism Compute Infrastructure - ECS, Fargate, and Lambda',
  vpc: networkStack.vpc,
  agentSecurityGroup: securityStack.agentSecurityGroup,
  mcpToolsSecurityGroup: securityStack.mcpToolsSecurityGroup,
  lambdaSecurityGroup: securityStack.lambdaSecurityGroup,
  uploadsBucket: storageStack.uploadsBucket,
  artifactsBucket: storageStack.artifactsBucket,
  kendraBucket: storageStack.kendraBucket,
  missionStatusTable: storageStack.missionStatusTable,
  toolResultsTable: storageStack.toolResultsTable,
  findingsTable: storageStack.findingsArchiveTable,
  elastiCacheCluster: storageStack.elastiCacheCluster,
  kendraIndex: intelligenceStack.kendraIndex,
  kmsKey: securityStack.kmsKey,
  tags: {
    Project: 'Hivemind-Prism',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});
computeStack.addDependency(intelligenceStack);

// Orchestration Stack - Step Functions, EventBridge
const orchestrationStack = new OrchestrationStack(app, `${stackPrefix}-Orchestration`, {
  env,
  description: 'Hivemind-Prism Orchestration Infrastructure - Step Functions and EventBridge',
  uploadsBucket: storageStack.uploadsBucket,
  missionStatusTable: storageStack.missionStatusTable,
  agentTaskDefinitions: computeStack.agentTaskDefinitions,
  unpackLambda: computeStack.unpackLambda,
  failureHandlerLambda: computeStack.failureHandlerLambda,
  ecsCluster: computeStack.ecsCluster,
  vpc: networkStack.vpc,
  agentSecurityGroup: securityStack.agentSecurityGroup,
  mcpToolsSecurityGroup: securityStack.mcpToolsSecurityGroup,
  tags: {
    Project: 'Hivemind-Prism',
    Environment: 'Production',
    ManagedBy: 'CDK',
  },
});
orchestrationStack.addDependency(computeStack);

// Outputs are now defined within their respective stack files
// This avoids the "CfnOutput should be created in the scope of a Stack" error

app.synth();