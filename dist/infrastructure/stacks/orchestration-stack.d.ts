import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
export interface OrchestrationStackProps extends cdk.StackProps {
    uploadsBucket: s3.Bucket;
    missionStatusTable: dynamodb.Table;
    agentTaskDefinitions: {
        [key: string]: ecs.FargateTaskDefinition;
    };
    unpackLambda: lambda.Function;
    failureHandlerLambda: lambda.Function;
    ecsCluster: ecs.Cluster;
    vpc: ec2.Vpc;
    agentSecurityGroup: ec2.SecurityGroup;
    mcpToolsSecurityGroup: ec2.SecurityGroup;
}
export declare class OrchestrationStack extends cdk.Stack {
    readonly stateMachine: sfn.StateMachine;
    readonly eventRule: events.Rule;
    readonly completionTopic: sns.Topic;
    constructor(scope: Construct, id: string, props: OrchestrationStackProps);
    private createAgentTask;
}
