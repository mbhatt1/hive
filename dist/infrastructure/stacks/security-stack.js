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
        // KMS key policies will be added by resource stacks to avoid circular dependencies
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
        // Add KMS permissions for CLI role
        this.cliUserRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey*',
                'kms:DescribeKey',
            ],
            resources: [this.kmsKey.keyArn],
        }));
        // Add S3 and DynamoDB permissions using ARN patterns to avoid circular dependencies
        this.cliUserRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:PutObject',
                's3:PutObjectAcl',
                's3:AbortMultipartUpload',
                's3:ListMultipartUploadParts',
            ],
            resources: [`arn:aws:s3:::hivemind-uploads-${cdk.Stack.of(this).account}/uploads/*`],
        }));
        this.cliUserRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
            ],
            resources: [`arn:aws:dynamodb:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:table/HivemindMissionStatus`],
        }));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHktc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9pbmZyYXN0cnVjdHVyZS9zdGFja3Mvc2VjdXJpdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBTzNDLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBUTFDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsZ0NBQWdDO1FBQ2hDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDN0MsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixXQUFXLEVBQUUsZ0RBQWdEO1lBQzdELEtBQUssRUFBRSx5QkFBeUI7WUFDaEMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTTtZQUN2QyxhQUFhLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1NBQ3JDLENBQUMsQ0FBQztRQUVILG1GQUFtRjtRQUVuRix3Q0FBd0M7UUFFeEMsK0JBQStCO1FBQy9CLElBQUksQ0FBQyx5QkFBeUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQzdFLEdBQUcsRUFBRSxLQUFLLENBQUMsR0FBRztZQUNkLFdBQVcsRUFBRSw0Q0FBNEM7WUFDekQsZ0JBQWdCLEVBQUUsSUFBSTtTQUN2QixDQUFDLENBQUM7UUFFSCw2QkFBNkI7UUFDN0IsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUs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Q0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ3hDLEtBQUssRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU87WUFDL0IsV0FBVyxFQUFFLGtDQUFrQztZQUMvQyxVQUFVLEVBQUUsOEJBQThCO1NBQzNDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdKRCxzQ0E2SkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMga21zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rbXMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VjdXJpdHlTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICB2cGM6IGVjMi5WcGM7XG59XG5cbmV4cG9ydCBjbGFzcyBTZWN1cml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGttc0tleToga21zLktleTtcbiAgcHVibGljIHJlYWRvbmx5IGFnZW50U2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG4gIHB1YmxpYyByZWFkb25seSBtY3BUb29sc1NlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwOiBlYzIuU2VjdXJpdHlHcm91cDtcbiAgcHVibGljIHJlYWRvbmx5IHZwY0VuZHBvaW50c1NlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgY2xpVXNlclJvbGU6IGlhbS5Sb2xlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBTZWN1cml0eVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT0gS01TIEtFWSA9PT09PT09PT09XG4gICAgdGhpcy5rbXNLZXkgPSBuZXcga21zLktleSh0aGlzLCAnSGl2ZW1pbmRLZXknLCB7XG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS01TIGtleSBmb3IgSGl2ZW1pbmQtUHJpc20gcGxhdGZvcm0gZW5jcnlwdGlvbicsXG4gICAgICBhbGlhczogJ2FsaWFzL2hpdmVtaW5kLXBsYXRmb3JtJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHBlbmRpbmdXaW5kb3c6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICB9KTtcblxuICAgIC8vIEtNUyBrZXkgcG9saWNpZXMgd2lsbCBiZSBhZGRlZCBieSByZXNvdXJjZSBzdGFja3MgdG8gYXZvaWQgY2lyY3VsYXIgZGVwZW5kZW5jaWVzXG5cbiAgICAvLyA9PT09PT09PT09IFNFQ1VSSVRZIEdST1VQUyA9PT09PT09PT09XG4gICAgXG4gICAgLy8gVlBDIEVuZHBvaW50cyBTZWN1cml0eSBHcm91cFxuICAgIHRoaXMudnBjRW5kcG9pbnRzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnVnBjRW5kcG9pbnRzU2cnLCB7XG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIFZQQyBpbnRlcmZhY2UgZW5kcG9pbnRzJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBBZ2VudCBUYXNrcyBTZWN1cml0eSBHcm91cFxuICAgIHRoaXMuYWdlbnRTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdBZ2VudFRhc2tzU2cnLCB7XG4gICAgICB2cGM6IHByb3BzLnZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIEFJIGFnZW50IEZhcmdhdGUgdGFza3MnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogZmFsc2UsXG4gICAgfSk7XG5cbiAgICAvLyBBbGxvdyBhZ2VudHMgdG8gY29tbXVuaWNhdGUgd2l0aCBWUEMgZW5kcG9pbnRzXG4gICAgdGhpcy5hZ2VudFNlY3VyaXR5R3JvdXAuYWRkRWdyZXNzUnVsZShcbiAgICAgIHRoaXMudnBjRW5kcG9pbnRzU2VjdXJpdHlHcm91cCxcbiAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgJ0FsbG93IEhUVFBTIHRvIFZQQyBlbmRwb2ludHMnXG4gICAgKTtcblxuICAgIC8vIE1DUCBUb29scyBTZWN1cml0eSBHcm91cFxuICAgIHRoaXMubWNwVG9vbHNTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdNY3BUb29sc1NnJywge1xuICAgICAgdnBjOiBwcm9wcy52cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBNQ1AgdG9vbCBGYXJnYXRlIHRhc2tzJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8gQWxsb3cgTUNQIHRvb2xzIHRvIGNvbW11bmljYXRlIHdpdGggVlBDIGVuZHBvaW50c1xuICAgIHRoaXMubWNwVG9vbHNTZWN1cml0eUdyb3VwLmFkZEVncmVzc1J1bGUoXG4gICAgICB0aGlzLnZwY0VuZHBvaW50c1NlY3VyaXR5R3JvdXAsXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgICdBbGxvdyBIVFRQUyB0byBWUEMgZW5kcG9pbnRzJ1xuICAgICk7XG5cbiAgICAvLyBFbGFzdGlDYWNoZSBTZWN1cml0eSBHcm91cFxuICAgIHRoaXMuZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdFbGFzdGlDYWNoZVNnJywge1xuICAgICAgdnBjOiBwcm9wcy52cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBFbGFzdGlDYWNoZSBSZWRpcyBjbHVzdGVyJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8gQWxsb3cgYWdlbnRzIHRvIGFjY2VzcyBSZWRpc1xuICAgIHRoaXMuZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgdGhpcy5hZ2VudFNlY3VyaXR5R3JvdXAsXG4gICAgICBlYzIuUG9ydC50Y3AoNjM3OSksXG4gICAgICAnQWxsb3cgYWdlbnRzIHRvIGFjY2VzcyBSZWRpcydcbiAgICApO1xuXG4gICAgLy8gQWxsb3cgVlBDIGVuZHBvaW50cyB0byByZWNlaXZlIHRyYWZmaWMgZnJvbSBhZ2VudCBhbmQgTUNQIHRhc2tzXG4gICAgdGhpcy52cGNFbmRwb2ludHNTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgdGhpcy5hZ2VudFNlY3VyaXR5R3JvdXAsXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgICdBbGxvdyBhZ2VudHMgdG8gYWNjZXNzIGVuZHBvaW50cydcbiAgICApO1xuXG4gICAgdGhpcy52cGNFbmRwb2ludHNTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKFxuICAgICAgdGhpcy5tY3BUb29sc1NlY3VyaXR5R3JvdXAsXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgICdBbGxvdyBNQ1AgdG9vbHMgdG8gYWNjZXNzIGVuZHBvaW50cydcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PSBJQU0gUk9MRVMgPT09PT09PT09PVxuXG4gICAgLy8gQ0xJIFVzZXIgUm9sZSAoQXNzdW1lUm9sZSB0YXJnZXQgZm9yIGRldmVsb3BlcnMvQ0kpXG4gICAgdGhpcy5jbGlVc2VyUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnSGl2ZW1pbmRDbGlVc2VyUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5Bcm5QcmluY2lwYWwoYGFybjphd3M6aWFtOjoke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fTpyb290YCksXG4gICAgICByb2xlTmFtZTogJ0hpdmVtaW5kQ2xpVXNlclJvbGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdSb2xlIGFzc3VtZWQgYnkgZGV2ZWxvcGVycyBhbmQgQ0kvQ0QgdG8gdXBsb2FkIGNvZGUnLFxuICAgICAgbWF4U2Vzc2lvbkR1cmF0aW9uOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgS01TIHBlcm1pc3Npb25zIGZvciBDTEkgcm9sZVxuICAgIHRoaXMuY2xpVXNlclJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdrbXM6RW5jcnlwdCcsXG4gICAgICAgICAgJ2ttczpEZWNyeXB0JyxcbiAgICAgICAgICAna21zOlJlRW5jcnlwdConLFxuICAgICAgICAgICdrbXM6R2VuZXJhdGVEYXRhS2V5KicsXG4gICAgICAgICAgJ2ttczpEZXNjcmliZUtleScsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW3RoaXMua21zS2V5LmtleUFybl0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBBZGQgUzMgYW5kIER5bmFtb0RCIHBlcm1pc3Npb25zIHVzaW5nIEFSTiBwYXR0ZXJucyB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmNpZXNcbiAgICB0aGlzLmNsaVVzZXJSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcbiAgICAgICAgICAnczM6UHV0T2JqZWN0QWNsJyxcbiAgICAgICAgICAnczM6QWJvcnRNdWx0aXBhcnRVcGxvYWQnLFxuICAgICAgICAgICdzMzpMaXN0TXVsdGlwYXJ0VXBsb2FkUGFydHMnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpzMzo6OmhpdmVtaW5kLXVwbG9hZHMtJHtjZGsuU3RhY2sub2YodGhpcykuYWNjb3VudH0vdXBsb2Fkcy8qYF0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICB0aGlzLmNsaVVzZXJSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnZHluYW1vZGI6UHV0SXRlbScsXG4gICAgICAgICAgJ2R5bmFtb2RiOkdldEl0ZW0nLFxuICAgICAgICAgICdkeW5hbW9kYjpVcGRhdGVJdGVtJyxcbiAgICAgICAgICAnZHluYW1vZGI6UXVlcnknLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpkeW5hbW9kYjoke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259OiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OnRhYmxlL0hpdmVtaW5kTWlzc2lvblN0YXR1c2BdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdLbXNLZXlJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmttc0tleS5rZXlJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS01TIEtleSBJRCBmb3IgcGxhdGZvcm0gZW5jcnlwdGlvbicsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1LbXNLZXlJZCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnS21zS2V5QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMua21zS2V5LmtleUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnS01TIEtleSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tS21zS2V5QXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbGlVc2VyUm9sZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNsaVVzZXJSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0NMSSBVc2VyIFJvbGUgQVJOIGZvciBBc3N1bWVSb2xlJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUNsaVVzZXJSb2xlQXJuJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==