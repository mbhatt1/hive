import * as cdk from 'aws-cdk-lib';
import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
export interface IntelligenceStackProps extends cdk.StackProps {
    kendraBucket: s3.Bucket;
    kmsKey: kms.Key;
}
export declare class IntelligenceStack extends cdk.Stack {
    readonly kendraIndex: kendra.CfnIndex;
    readonly kendraDataSource: kendra.CfnDataSource;
    constructor(scope: Construct, id: string, props: IntelligenceStackProps);
}
