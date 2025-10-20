import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
export declare class NetworkStack extends cdk.Stack {
    readonly vpc: ec2.Vpc;
    readonly privateSubnets: ec2.ISubnet[];
    readonly isolatedSubnets: ec2.ISubnet[];
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
