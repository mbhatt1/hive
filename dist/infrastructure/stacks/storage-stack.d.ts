import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
export interface StorageStackProps extends cdk.StackProps {
    vpc: ec2.Vpc;
    kmsKey: kms.Key;
    elastiCacheSecurityGroup: ec2.SecurityGroup;
}
export declare class StorageStack extends cdk.Stack {
    readonly uploadsBucket: s3.Bucket;
    readonly artifactsBucket: s3.Bucket;
    readonly kendraBucket: s3.Bucket;
    readonly missionStatusTable: dynamodb.Table;
    readonly toolResultsTable: dynamodb.Table;
    readonly findingsArchiveTable: dynamodb.Table;
    readonly elastiCacheCluster: elasticache.CfnCacheCluster;
    readonly eventBus: events.EventBus;
    constructor(scope: Construct, id: string, props: StorageStackProps);
}
