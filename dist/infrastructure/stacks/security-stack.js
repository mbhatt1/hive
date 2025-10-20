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
exports.SecurityStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
class SecurityStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========== KMS KEY ==========
        this.kmsKey = new kms.Key(this, 'HivemindKey', {
            enableKeyRotation: true,
            description: 'KMS key for Hivemind-Prism platform encryption',
            alias: 'alias/hivemind-platform',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            pendingWindow: cdk.Duration.days(30),
        });
        // Add key policy for AWS services
        this.kmsKey.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'Allow S3 to use key',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
            actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
            resources: ['*'],
            conditions: {
                StringEquals: {
                    'kms:ViaService': `s3.${cdk.Stack.of(this).region}.amazonaws.com`,
                },
            },
        }));
        this.kmsKey.addToResourcePolicy(new iam.PolicyStatement({
            sid: 'Allow DynamoDB to use key',
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal('dynamodb.amazonaws.com')],
            actions: ['kms:Decrypt', 'kms:DescribeKey', 'kms:CreateGrant'],
            resources: ['*'],
            conditions: {
                StringEquals: {
                    'kms:ViaService': `dynamodb.${cdk.Stack.of(this).region}.amazonaws.com`,
                },
            },
        }));
        // ========== SECURITY GROUPS ==========
        // VPC Endpoints Security Group
        this.vpcEndpointsSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointsSg', {
            vpc: props.vpc,
            description: 'Security group for VPC interface endpoints',
            allowAllOutbound: true,
        });
        // Agent Tasks Security Group
        this.agentSecurityGroup = new ec2.SecurityGroup(this, 'AgentTasksSg', {
            vpc: props.vpc,
            description: 'Security group for AI agent Fargate tasks',
            allowAllOutbound: false,
        });
        // Allow agents to communicate with VPC endpoints
        this.agentSecurityGroup.addEgressRule(this.vpcEndpointsSecurityGroup, ec2.Port.tcp(443), 'Allow HTTPS to VPC endpoints');
        // MCP Tools Security Group
        this.mcpToolsSecurityGroup = new ec2.SecurityGroup(this, 'McpToolsSg', {
            vpc: props.vpc,
            description: 'Security group for MCP tool Fargate tasks',
            allowAllOutbound: false,
        });
        // Allow MCP tools to communicate with VPC endpoints
        this.mcpToolsSecurityGroup.addEgressRule(this.vpcEndpointsSecurityGroup, ec2.Port.tcp(443), 'Allow HTTPS to VPC endpoints');
        // ElastiCache Security Group
        this.elastiCacheSecurityGroup = new ec2.SecurityGroup(this, 'ElastiCacheSg', {
            vpc: props.vpc,
            description: 'Security group for ElastiCache Redis cluster',
            allowAllOutbound: false,
        });
        // Allow agents to access Redis
        this.elastiCacheSecurityGroup.addIngressRule(this.agentSecurityGroup, ec2.Port.tcp(6379), 'Allow agents to access Redis');
        // Allow VPC endpoints to receive traffic from agent and MCP tasks
        this.vpcEndpointsSecurityGroup.addIngressRule(this.agentSecurityGroup, ec2.Port.tcp(443), 'Allow agents to access endpoints');
        this.vpcEndpointsSecurityGroup.addIngressRule(this.mcpToolsSecurityGroup, ec2.Port.tcp(443), 'Allow MCP tools to access endpoints');
        // ========== IAM ROLES ==========
        // CLI User Role (AssumeRole target for developers/CI)
        this.cliUserRole = new iam.Role(this, 'HivemindCliUserRole', {
            assumedBy: new iam.ArnPrincipal(`arn:aws:iam::${cdk.Stack.of(this).account}:root`),
            roleName: 'HivemindCliUserRole',
            description: 'Role assumed by developers and CI/CD to upload code',
            maxSessionDuration: cdk.Duration.hours(1),
        });
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
exports.SecurityStack = SecurityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9pbmZyYXN0cnVjdHVyZS9zdGFja3Mvc2VjdXJpdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBTzNDLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBUTFDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsZ0NBQWdDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDN0MsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixXQUFXLEVBQUUsZ0RBQWdEO1lBQzdELEtBQUssRUFBRSx5QkFBeUI7WUFDaEMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxhQUFhLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1NBQ3JDLENBQUMsQ0FBQztRQUVILGtDQUFrQztRQUNsQyxJQUFJLENBQUMsTUFBTSxDQUFDLG1CQUFtQixDQUM3QixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsR0FBRyxFQUFFLHFCQUFxQjtZQUMxQixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLFVBQVUsRUFBRSxDQUFDLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDMUQsT0FBTyxFQUFFLENBQUMsYUFBYSxFQUFFLHFCQUFxQixDQUFDO1lBQy9DLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztZ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Qy9CLFdBQVcsRUFBRSxrQ0FBa0M7WUFDL0MsVUFBVSxFQUFFLDhCQUE4QjtTQUMzQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFoSkQsc0NBZ0pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNlY3VyaXR5U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdnBjOiBlYzIuVnBjO1xufVxuXG5leHBvcnQgY2xhc3MgU2VjdXJpdHlTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBrbXNLZXk6IGttcy5LZXk7XG4gIHB1YmxpYyByZWFkb25seSBhZ2VudFNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgbWNwVG9vbHNTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcbiAgcHVibGljIHJlYWRvbmx5IGVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG4gIHB1YmxpYyByZWFkb25seSB2cGNFbmRwb2ludHNTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcbiAgcHVibGljIHJlYWRvbmx5IGNsaVVzZXJSb2xlOiBpYW0uUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2VjdXJpdHlTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyA9PT09PT09PT09IEtNUyBLRVkgPT09PT09PT09PVxuICAgIHRoaXMua21zS2V5ID0gbmV3IGttcy5LZXkodGhpcywgJ0hpdmVtaW5kS2V5Jywge1xuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBrZXkgZm9yIEhpdmVtaW5kLVByaXNtIHBsYXRmb3JtIGVuY3J5cHRpb24nLFxuICAgICAgYWxpYXM6ICdhbGlhcy9oaXZlbWluZC1wbGF0Zm9ybScsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBwZW5kaW5nV2luZG93OiBjZGsuRHVyYXRpb24uZGF5cygzMCksXG4gICAgfSk7XG5cbiAgICAvLyBBZGQga2V5IHBvbGljeSBmb3IgQVdTIHNlcnZpY2VzXG4gICAgdGhpcy5rbXNLZXkuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiAnQWxsb3cgUzMgdG8gdXNlIGtleScsXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW25ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnczMuYW1hem9uYXdzLmNvbScpXSxcbiAgICAgICAgYWN0aW9uczogWydrbXM6RGVjcnlwdCcsICdrbXM6R2VuZXJhdGVEYXRhS2V5J10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdrbXM6VmlhU2VydmljZSc6IGBzMy4ke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICB0aGlzLmttc0tleS5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6ICdBbGxvdyBEeW5hbW9EQiB0byB1c2Uga2V5JyxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdkeW5hbW9kYi5hbWF6b25hd3MuY29tJyldLFxuICAgICAgICBhY3Rpb25zOiBbJ2ttczpEZWNyeXB0JywgJ2ttczpEZXNjcmliZUtleScsICdrbXM6Q3JlYXRlR3JhbnQnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgJ2ttczpWaWFTZXJ2aWNlJzogYGR5bmFtb2RiLiR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT0gU0VDVVJJVFkgR1JPVVBTID09PT09PT09PT1cbiAgICBcbiAgICAvLyBWUEMgRW5kcG9pbnRzIFNlY3VyaXR5IEdyb3VwXG4gICAgdGhpcy52cGNFbmRwb2ludHNTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdWcGNFbmRwb2ludHNTZycsIHtcbiAgICAgIHZwYzogcHJvcHMudnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgVlBDIGludGVyZmFjZSBlbmRwb2ludHMnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFnZW50IFRhc2tzIFNlY3VyaXR5IEdyb3VwXG4gICAgdGhpcy5hZ2VudFNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0FnZW50VGFza3NTZycsIHtcbiAgICAgIHZwYzogcHJvcHMudnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgQUkgYWdlbnQgRmFyZ2F0ZSB0YXNrcycsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIC8vIEFsbG93IGFnZW50cyB0byBjb21tdW5pY2F0ZSB3aXRoIFZQQyBlbmRwb2ludHNcbiAgICB0aGlzLmFnZW50U2VjdXJpdHlHcm91cC5hZGRFZ3Jlc3NSdWxlKFxuICAgICAgdGhpcy52cGNFbmRwb2ludHNTZWN1cml0eUdyb3VwLFxuICAgICAgZWMyLlBvcnQudGNwKDQ0MyksXG4gICAgICAnQWxsb3cgSFRUUFMgdG8gVlBDIGVuZHBvaW50cydcbiAgICApO1xuXG4gICAgLy8gTUNQIFRvb2xzIFNlY3VyaXR5IEdyb3VwXG4gICAgdGhpcy5tY3BUb29sc1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ01jcFRvb2xzU2cnLCB7XG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIE1DUCB0b29sIEZhcmdhdGUgdGFza3MnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG5cbiAgICAvLyBBbGxvdyBNQ1AgdG9vbHMgdG8gY29tbXVuaWNhdGUgd2l0aCBWUEMgZW5kcG9pbnRzXG4gICAgdGhpcy5tY3BUb29sc1NlY3VyaXR5R3JvdXAuYWRkRWdyZXNzUnVsZShcbiAgICAgIHRoaXMudnBjRW5kcG9pbnRzU2VjdXJpdHlHcm91cCxcbiAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgJ0FsbG93IEhUVFBTIHRvIFZQQyBlbmRwb2ludHMnXG4gICAgKTtcblxuICAgIC8vIEVsYXN0aUNhY2hlIFNlY3VyaXR5IEdyb3VwXG4gICAgdGhpcy5lbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0VsYXN0aUNhY2hlU2cnLCB7XG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIEVsYXN0aUNhY2hlIFJlZGlzIGNsdXN0ZXInLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG5cbiAgICAvLyBBbGxvdyBhZ2VudHMgdG8gYWNjZXNzIFJlZGlzXG4gICAgdGhpcy5lbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICB0aGlzLmFnZW50U2VjdXJpdHlHcm91cCxcbiAgICAgIGVjMi5Qb3J0LnRjcCg2Mzc5KSxcbiAgICAgICdBbGxvdyBhZ2VudHMgdG8gYWNjZXNzIFJlZGlzJ1xuICAgICk7XG5cbiAgICAvLyBBbGxvdyBWUEMgZW5kcG9pbnRzIHRvIHJlY2VpdmUgdHJhZmZpYyBmcm9tIGFnZW50IGFuZCBNQ1AgdGFza3NcbiAgICB0aGlzLnZwY0VuZHBvaW50c1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICB0aGlzLmFnZW50U2VjdXJpdHlHcm91cCxcbiAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgJ0FsbG93IGFnZW50cyB0byBhY2Nlc3MgZW5kcG9pbnRzJ1xuICAgICk7XG5cbiAgICB0aGlzLnZwY0VuZHBvaW50c1NlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICB0aGlzLm1jcFRvb2xzU2VjdXJpdHlHcm91cCxcbiAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgJ0FsbG93IE1DUCB0b29scyB0byBhY2Nlc3MgZW5kcG9pbnRzJ1xuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09IElBTSBST0xFUyA9PT09PT09PT09XG5cbiAgICAvLyBDTEkgVXNlciBSb2xlIChBc3N1bWVSb2xlIHRhcmdldCBmb3IgZGV2ZWxvcGVycy9DSSlcbiAgICB0aGlzLmNsaVVzZXJSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdIaXZlbWluZENsaVVzZXJSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkFyblByaW5jaXBhbChgYXJuOmF3czppYW06OiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OnJvb3RgKSxcbiAgICAgIHJvbGVOYW1lOiAnSGl2ZW1pbmRDbGlVc2VyUm9sZScsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JvbGUgYXNzdW1lZCBieSBkZXZlbG9wZXJzIGFuZCBDSS9DRCB0byB1cGxvYWQgY29kZScsXG4gICAgICBtYXhTZXNzaW9uRHVyYXRpb246IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnS21zS2V5SWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5rbXNLZXkua2V5SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBLZXkgSUQgZm9yIHBsYXRmb3JtIGVuY3J5cHRpb24nLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tS21zS2V5SWQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ttc0tleUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmttc0tleS5rZXlBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBLZXkgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUttc0tleUFybicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xpVXNlclJvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jbGlVc2VyUm9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDTEkgVXNlciBSb2xlIEFSTiBmb3IgQXNzdW1lUm9sZScsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1DbGlVc2VyUm9sZUFybicsXG4gICAgfSk7XG4gIH1cbn0iXX0=