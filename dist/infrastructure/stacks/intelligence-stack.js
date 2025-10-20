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
exports.IntelligenceStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const kendra = __importStar(require("aws-cdk-lib/aws-kendra"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
class IntelligenceStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========== KENDRA INDEX ==========
        // Create IAM role for Kendra Index
        const kendraIndexRole = new iam.Role(this, 'KendraIndexRole', {
            assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
            description: 'Role for Kendra index operations',
        });
        kendraIndexRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['cloudwatch:PutMetricData'],
            resources: ['*'],
            conditions: {
                StringEquals: {
                    'cloudwatch:namespace': 'AWS/Kendra',
                },
            },
        }));
        kendraIndexRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            resources: [
                `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/kendra/*`,
            ],
        }));
        // Create Kendra Index
        this.kendraIndex = new kendra.CfnIndex(this, 'InstitutionalMemoryIndex', {
            name: 'HivemindInstitutionalMemory',
            edition: 'DEVELOPER_EDITION', // Enterprise for production
            roleArn: kendraIndexRole.roleArn,
            description: 'Institutional memory index for security findings and patterns',
            documentMetadataConfigurations: [
                {
                    name: '_severity',
                    type: 'STRING_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: true,
                        sortable: true,
                    },
                },
                {
                    name: '_repo_name',
                    type: 'STRING_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: true,
                        sortable: true,
                    },
                },
                {
                    name: '_timestamp',
                    type: 'DATE_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: false,
                        sortable: true,
                    },
                },
                {
                    name: '_pattern_type',
                    type: 'STRING_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: true,
                        sortable: false,
                    },
                },
                {
                    name: '_agent_consensus_score',
                    type: 'LONG_VALUE',
                    search: {
                        displayable: true,
                        facetable: false,
                        searchable: false,
                        sortable: true,
                    },
                },
            ],
        });
        // Create IAM role for Kendra Data Source
        const kendraDataSourceRole = new iam.Role(this, 'KendraDataSourceRole', {
            assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
            description: 'Role for Kendra S3 data source',
        });
        props.kendraBucket.grantRead(kendraDataSourceRole);
        kendraDataSourceRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['kendra:BatchPutDocument', 'kendra:BatchDeleteDocument'],
            resources: [this.kendraIndex.attrArn],
        }));
        // Create Kendra Data Source for S3
        this.kendraDataSource = new kendra.CfnDataSource(this, 'KendraS3DataSource', {
            indexId: this.kendraIndex.attrId,
            name: 'InstitutionalMemoryS3Source',
            type: 'S3',
            roleArn: kendraDataSourceRole.roleArn,
            dataSourceConfiguration: {
                s3Configuration: {
                    bucketName: props.kendraBucket.bucketName,
                    inclusionPrefixes: ['findings/', 'patterns/', 'policies/'],
                },
            },
            schedule: 'cron(0/15 * * * ? *)', // Sync every 15 minutes
        });
        this.kendraDataSource.addDependency(this.kendraIndex);
        // ========== OUTPUTS ==========
        new cdk.CfnOutput(this, 'KendraIndexId', {
            value: this.kendraIndex.attrId,
            description: 'Kendra Index ID for institutional memory',
            exportName: 'HivemindPrism-KendraIndexId',
        });
        new cdk.CfnOutput(this, 'KendraIndexArn', {
            value: this.kendraIndex.attrArn,
            description: 'Kendra Index ARN',
            exportName: 'HivemindPrism-KendraIndexArn',
        });
        // Note: Bedrock doesn't require explicit CDK resources as it's a managed service
        // Access is controlled via IAM policies in the Security Stack
        new cdk.CfnOutput(this, 'BedrockNote', {
            value: 'Bedrock access configured via IAM policies',
            description: 'Amazon Bedrock is accessed via API with IAM authentication',
        });
    }
}
exports.IntelligenceStack = IntelligenceStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWxsaWdlbmNlLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vaW5mcmFzdHJ1Y3R1cmUvc3RhY2tzL2ludGVsbGlnZW5jZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsK0RBQWlEO0FBQ2pELHlEQUEyQztBQVUzQyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSTlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNkI7UUFDckUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIscUNBQXFDO1FBRXJDLG1DQUFtQztRQUNuQyxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQzVELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxXQUFXLEVBQUUsa0NBQWtDO1NBQ2hELENBQUMsQ0FBQztRQUVILGVBQWUsQ0FBQyxXQUFXLENBQ3pCLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRSxDQUFDLDBCQUEwQixDQUFDO1lBQ3JDLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztZQUNoQixVQUFVLEVBQUU7Z0JBQ1YsWUFBWSxFQUFFO29CQUNaLHNCQUFzQixFQUFFLFlBQVk7aUJBQ3JDO2FBQ0Y7U0FDRixDQUFDLENBQ0gsQ0FBQztRQUVGLGVBQWUsQ0FBQyxXQUFXLENBQ3pCLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRSxDQUFDLHFCQUFx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bmltcG9ydCAqIGFzIGtlbmRyYSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta2VuZHJhJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBJbnRlbGxpZ2VuY2VTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBrZW5kcmFCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAga21zS2V5OiBrbXMuS2V5O1xufVxuXG5leHBvcnQgY2xhc3MgSW50ZWxsaWdlbmNlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkga2VuZHJhSW5kZXg6IGtlbmRyYS5DZm5JbmRleDtcbiAgcHVibGljIHJlYWRvbmx5IGtlbmRyYURhdGFTb3VyY2U6IGtlbmRyYS5DZm5EYXRhU291cmNlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBJbnRlbGxpZ2VuY2VTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyA9PT09PT09PT09IEtFTkRSQSBJTkRFWCA9PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIEtlbmRyYSBJbmRleFxuICAgIGNvbnN0IGtlbmRyYUluZGV4Um9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnS2VuZHJhSW5kZXhSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2tlbmRyYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ1JvbGUgZm9yIEtlbmRyYSBpbmRleCBvcGVyYXRpb25zJyxcbiAgICB9KTtcblxuICAgIGtlbmRyYUluZGV4Um9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2Nsb3Vkd2F0Y2g6UHV0TWV0cmljRGF0YSddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAnY2xvdWR3YXRjaDpuYW1lc3BhY2UnOiAnQVdTL0tlbmRyYScsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGtlbmRyYUluZGV4Um9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLCAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLCAnbG9nczpQdXRMb2dFdmVudHMnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6bG9nczoke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259OiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OmxvZy1ncm91cDovYXdzL2tlbmRyYS8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIENyZWF0ZSBLZW5kcmEgSW5kZXhcbiAgICB0aGlzLmtlbmRyYUluZGV4ID0gbmV3IGtlbmRyYS5DZm5JbmRleCh0aGlzLCAnSW5zdGl0dXRpb25hbE1lbW9yeUluZGV4Jywge1xuICAgICAgbmFtZTogJ0hpdmVtaW5kSW5zdGl0dXRpb25hbE1lbW9yeScsXG4gICAgICBlZGl0aW9uOiAnREVWRUxPUEVSX0VESVRJT04nLCAvLyBFbnRlcnByaXNlIGZvciBwcm9kdWN0aW9uXG4gICAgICByb2xlQXJuOiBrZW5kcmFJbmRleFJvbGUucm9sZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnSW5zdGl0dXRpb25hbCBtZW1vcnkgaW5kZXggZm9yIHNlY3VyaXR5IGZpbmRpbmdzIGFuZCBwYXR0ZXJucycsXG4gICAgICBkb2N1bWVudE1ldGFkYXRhQ29uZmlndXJhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdfc2V2ZXJpdHknLFxuICAgICAgICAgIHR5cGU6ICdTVFJJTkdfVkFMVUUnLFxuICAgICAgICAgIHNlYXJjaDoge1xuICAgICAgICAgICAgZGlzcGxheWFibGU6IHRydWUsXG4gICAgICAgICAgICBmYWNldGFibGU6IHRydWUsXG4gICAgICAgICAgICBzZWFyY2hhYmxlOiB0cnVlLFxuICAgICAgICAgICAgc29ydGFibGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdfcmVwb19uYW1lJyxcbiAgICAgICAgICB0eXBlOiAnU1RSSU5HX1ZBTFVFJyxcbiAgICAgICAgICBzZWFyY2g6IHtcbiAgICAgICAgICAgIGRpc3BsYXlhYmxlOiB0cnVlLFxuICAgICAgICAgICAgZmFjZXRhYmxlOiB0cnVlLFxuICAgICAgICAgICAgc2VhcmNoYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIHNvcnRhYmxlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnX3RpbWVzdGFtcCcsXG4gICAgICAgICAgdHlwZTogJ0RBVEVfVkFMVUUnLFxuICAgICAgICAgIHNlYXJjaDoge1xuICAgICAgICAgICAgZGlzcGxheWFibGU6IHRydWUsXG4gICAgICAgICAgICBmYWNldGFibGU6IHRydWUsXG4gICAgICAgICAgICBzZWFyY2hhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIHNvcnRhYmxlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnX3BhdHRlcm5fdHlwZScsXG4gICAgICAgICAgdHlwZTogJ1NUUklOR19WQUxVRScsXG4gICAgICAgICAgc2VhcmNoOiB7XG4gICAgICAgICAgICBkaXNwbGF5YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGZhY2V0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIHNlYXJjaGFibGU6IHRydWUsXG4gICAgICAgICAgICBzb3J0YWJsZTogZmFsc2UsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdfYWdlbnRfY29uc2Vuc3VzX3Njb3JlJyxcbiAgICAgICAgICB0eXBlOiAnTE9OR19WQUxVRScsXG4gICAgICAgICAgc2VhcmNoOiB7XG4gICAgICAgICAgICBkaXNwbGF5YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGZhY2V0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBzZWFyY2hhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIHNvcnRhYmxlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBLZW5kcmEgRGF0YSBTb3VyY2VcbiAgICBjb25zdCBrZW5kcmFEYXRhU291cmNlUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnS2VuZHJhRGF0YVNvdXJjZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgna2VuZHJhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBmb3IgS2VuZHJhIFMzIGRhdGEgc291cmNlJyxcbiAgICB9KTtcblxuICAgIHByb3BzLmtlbmRyYUJ1Y2tldC5ncmFudFJlYWQoa2VuZHJhRGF0YVNvdXJjZVJvbGUpO1xuXG4gICAga2VuZHJhRGF0YVNvdXJjZVJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydrZW5kcmE6QmF0Y2hQdXREb2N1bWVudCcsICdrZW5kcmE6QmF0Y2hEZWxldGVEb2N1bWVudCddLFxuICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmtlbmRyYUluZGV4LmF0dHJBcm5dLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQ3JlYXRlIEtlbmRyYSBEYXRhIFNvdXJjZSBmb3IgUzNcbiAgICB0aGlzLmtlbmRyYURhdGFTb3VyY2UgPSBuZXcga2VuZHJhLkNmbkRhdGFTb3VyY2UodGhpcywgJ0tlbmRyYVMzRGF0YVNvdXJjZScsIHtcbiAgICAgIGluZGV4SWQ6IHRoaXMua2VuZHJhSW5kZXguYXR0cklkLFxuICAgICAgbmFtZTogJ0luc3RpdHV0aW9uYWxNZW1vcnlTM1NvdXJjZScsXG4gICAgICB0eXBlOiAnUzMnLFxuICAgICAgcm9sZUFybjoga2VuZHJhRGF0YVNvdXJjZVJvbGUucm9sZUFybixcbiAgICAgIGRhdGFTb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIHMzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGJ1Y2tldE5hbWU6IHByb3BzLmtlbmRyYUJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICAgIGluY2x1c2lvblByZWZpeGVzOiBbJ2ZpbmRpbmdzLycsICdwYXR0ZXJucy8nLCAncG9saWNpZXMvJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc2NoZWR1bGU6ICdjcm9uKDAvMTUgKiAqICogPyAqKScsIC8vIFN5bmMgZXZlcnkgMTUgbWludXRlc1xuICAgIH0pO1xuXG4gICAgdGhpcy5rZW5kcmFEYXRhU291cmNlLmFkZERlcGVuZGVuY3kodGhpcy5rZW5kcmFJbmRleCk7XG5cbiAgICAvLyA9PT09PT09PT09IE9VVFBVVFMgPT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0tlbmRyYUluZGV4SWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5rZW5kcmFJbmRleC5hdHRySWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tlbmRyYSBJbmRleCBJRCBmb3IgaW5zdGl0dXRpb25hbCBtZW1vcnknLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tS2VuZHJhSW5kZXhJZCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnS2VuZHJhSW5kZXhBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5rZW5kcmFJbmRleC5hdHRyQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLZW5kcmEgSW5kZXggQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUtlbmRyYUluZGV4QXJuJyxcbiAgICB9KTtcblxuICAgIC8vIE5vdGU6IEJlZHJvY2sgZG9lc24ndCByZXF1aXJlIGV4cGxpY2l0IENESyByZXNvdXJjZXMgYXMgaXQncyBhIG1hbmFnZWQgc2VydmljZVxuICAgIC8vIEFjY2VzcyBpcyBjb250cm9sbGVkIHZpYSBJQU0gcG9saWNpZXMgaW4gdGhlIFNlY3VyaXR5IFN0YWNrXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JlZHJvY2tOb3RlJywge1xuICAgICAgdmFsdWU6ICdCZWRyb2NrIGFjY2VzcyBjb25maWd1cmVkIHZpYSBJQU0gcG9saWNpZXMnLFxuICAgICAgZGVzY3JpcHRpb246ICdBbWF6b24gQmVkcm9jayBpcyBhY2Nlc3NlZCB2aWEgQVBJIHdpdGggSUFNIGF1dGhlbnRpY2F0aW9uJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==