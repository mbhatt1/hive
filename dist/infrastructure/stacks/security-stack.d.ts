import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
export interface SecurityStackProps extends cdk.StackProps {
    vpc: ec2.Vpc;
}
export declare class SecurityStack extends cdk.Stack {
    readonly kmsKey: kms.Key;
    readonly agentSecurityGroup: ec2.SecurityGroup;
    readonly mcpToolsSecurityGroup: ec2.SecurityGroup;
    readonly elastiCacheSecurityGroup: ec2.SecurityGroup;
    readonly vpcEndpointsSecurityGroup: ec2.SecurityGroup;
    readonly cliUserRole: iam.Role;
    constructor(scope: Construct, id: string, props: SecurityStackProps);
}
