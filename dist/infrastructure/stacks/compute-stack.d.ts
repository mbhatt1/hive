import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as kms from 'aws-cdk-lib/aws-kms';
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
export declare class ComputeStack extends cdk.Stack {
    readonly ecsCluster: ecs.Cluster;
    readonly agentTaskDefinitions: {
        [key: string]: ecs.FargateTaskDefinition;
    };
    readonly mcpTaskDefinitions: {
        [key: string]: ecs.FargateTaskDefinition;
    };
    readonly unpackLambda: lambda.Function;
    readonly memoryIngestorLambda: lambda.Function;
    readonly failureHandlerLambda: lambda.Function;
    readonly agentTaskRoles: {
        [key: string]: iam.Role;
    };
    readonly mcpServerTaskRole: iam.Role;
    constructor(scope: Construct, id: string, props: ComputeStackProps);
    private createExecutionRole;
    private createAgentRole;
}
