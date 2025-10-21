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
            edition: 'DEVELOPER_EDITION', // Use ENTERPRISE_EDITION for production
            roleArn: kendraIndexRole.roleArn,
            description: 'Institutional memory index for security findings and patterns',
            documentMetadataConfigurations: [
                {
                    name: 'severity',
                    type: 'STRING_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: true,
                        sortable: true,
                    },
                },
                {
                    name: 'repo_name',
                    type: 'STRING_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: true,
                        sortable: true,
                    },
                },
                {
                    name: 'timestamp',
                    type: 'DATE_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: false,
                        sortable: true,
                    },
                },
                {
                    name: 'pattern_type',
                    type: 'STRING_VALUE',
                    search: {
                        displayable: true,
                        facetable: true,
                        searchable: true,
                        sortable: false,
                    },
                },
                {
                    name: 'agent_consensus_score',
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
        props.kmsKey.grantDecrypt(kendraDataSourceRole);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWxsaWdlbmNlLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vaW5mcmFzdHJ1Y3R1cmUvc3RhY2tzL2ludGVsbGlnZW5jZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsK0RBQWlEO0FBQ2pELHlEQUEyQztBQVUzQyxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSTlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNkI7UUFDckUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIscUNBQXFDO1FBRXJDLG1DQUFtQztRQUNuQyxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQzVELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxXQUFXLEVBQUUsa0NBQWtDO1NBQ2hELENBQUMsQ0FBQztRQUVILGVBQWUsQ0FBQyxXQUFXLENBQ3pCLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRSxDQUFDLDBCQUEwQixDQUFDO1lBQ3JDLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztZQUNoQixVQUFVLEVBQUU7Z0JBQ1YsWUFBWSxFQUFFO29CQUNaLHNCQUFzQixFQUFFLFlBQVk7aUJBQ3JDO2FBQ0Y7U0FDRixDQUFDLENBQ0gsQ0FBQztRQUVGLGVBQWUsQ0FBQyxXQUFXLENBQ3pCLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQ3hCLE9BQU8sRUFBRSxDQUFDLHFCQUFx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b3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMga2VuZHJhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1rZW5kcmEnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgczMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzJztcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEludGVsbGlnZW5jZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGtlbmRyYUJ1Y2tldDogczMuQnVja2V0O1xuICBrbXNLZXk6IGttcy5LZXk7XG59XG5cbmV4cG9ydCBjbGFzcyBJbnRlbGxpZ2VuY2VTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBrZW5kcmFJbmRleDoga2VuZHJhLkNmbkluZGV4O1xuICBwdWJsaWMgcmVhZG9ubHkga2VuZHJhRGF0YVNvdXJjZToga2VuZHJhLkNmbkRhdGFTb3VyY2U7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEludGVsbGlnZW5jZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT0gS0VORFJBIElOREVYID09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgS2VuZHJhIEluZGV4XG4gICAgY29uc3Qga2VuZHJhSW5kZXhSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdLZW5kcmFJbmRleFJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgna2VuZHJhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBmb3IgS2VuZHJhIGluZGV4IG9wZXJhdGlvbnMnLFxuICAgIH0pO1xuXG4gICAga2VuZHJhSW5kZXhSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnY2xvdWR3YXRjaDpQdXRNZXRyaWNEYXRhJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdjbG91ZHdhdGNoOm5hbWVzcGFjZSc6ICdBV1MvS2VuZHJhJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAga2VuZHJhSW5kZXhSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFsnbG9nczpDcmVhdGVMb2dHcm91cCcsICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpsb2dzOiR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn06JHtjZGsuU3RhY2sub2YodGhpcykuYWNjb3VudH06bG9nLWdyb3VwOi9hd3Mva2VuZHJhLypgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQ3JlYXRlIEtlbmRyYSBJbmRleFxuICAgIHRoaXMua2VuZHJhSW5kZXggPSBuZXcga2VuZHJhLkNmbkluZGV4KHRoaXMsICdJbnN0aXR1dGlvbmFsTWVtb3J5SW5kZXgnLCB7XG4gICAgICBuYW1lOiAnSGl2ZW1pbmRJbnN0aXR1dGlvbmFsTWVtb3J5JyxcbiAgICAgIGVkaXRpb246ICdERVZFTE9QRVJfRURJVElPTicsIC8vIFVzZSBFTlRFUlBSSVNFX0VESVRJT04gZm9yIHByb2R1Y3Rpb25cbiAgICAgIHJvbGVBcm46IGtlbmRyYUluZGV4Um9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnN0aXR1dGlvbmFsIG1lbW9yeSBpbmRleCBmb3Igc2VjdXJpdHkgZmluZGluZ3MgYW5kIHBhdHRlcm5zJyxcbiAgICAgIGRvY3VtZW50TWV0YWRhdGFDb25maWd1cmF0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ3NldmVyaXR5JyxcbiAgICAgICAgICB0eXBlOiAnU1RSSU5HX1ZBTFVFJyxcbiAgICAgICAgICBzZWFyY2g6IHtcbiAgICAgICAgICAgIGRpc3BsYXlhYmxlOiB0cnVlLFxuICAgICAgICAgICAgZmFjZXRhYmxlOiB0cnVlLFxuICAgICAgICAgICAgc2VhcmNoYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIHNvcnRhYmxlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAncmVwb19uYW1lJyxcbiAgICAgICAgICB0eXBlOiAnU1RSSU5HX1ZBTFVFJyxcbiAgICAgICAgICBzZWFyY2g6IHtcbiAgICAgICAgICAgIGRpc3BsYXlhYmxlOiB0cnVlLFxuICAgICAgICAgICAgZmFjZXRhYmxlOiB0cnVlLFxuICAgICAgICAgICAgc2VhcmNoYWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIHNvcnRhYmxlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcbiAgICAgICAgICB0eXBlOiAnREFURV9WQUxVRScsXG4gICAgICAgICAgc2VhcmNoOiB7XG4gICAgICAgICAgICBkaXNwbGF5YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGZhY2V0YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIHNlYXJjaGFibGU6IGZhbHNlLFxuICAgICAgICAgICAgc29ydGFibGU6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdwYXR0ZXJuX3R5cGUnLFxuICAgICAgICAgIHR5cGU6ICdTVFJJTkdfVkFMVUUnLFxuICAgICAgICAgIHNlYXJjaDoge1xuICAgICAgICAgICAgZGlzcGxheWFibGU6IHRydWUsXG4gICAgICAgICAgICBmYWNldGFibGU6IHRydWUsXG4gICAgICAgICAgICBzZWFyY2hhYmxlOiB0cnVlLFxuICAgICAgICAgICAgc29ydGFibGU6IGZhbHNlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnYWdlbnRfY29uc2Vuc3VzX3Njb3JlJyxcbiAgICAgICAgICB0eXBlOiAnTE9OR19WQUxVRScsXG4gICAgICAgICAgc2VhcmNoOiB7XG4gICAgICAgICAgICBkaXNwbGF5YWJsZTogdHJ1ZSxcbiAgICAgICAgICAgIGZhY2V0YWJsZTogZmFsc2UsXG4gICAgICAgICAgICBzZWFyY2hhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIHNvcnRhYmxlOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBLZW5kcmEgRGF0YSBTb3VyY2VcbiAgICBjb25zdCBrZW5kcmFEYXRhU291cmNlUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnS2VuZHJhRGF0YVNvdXJjZVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgna2VuZHJhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBmb3IgS2VuZHJhIFMzIGRhdGEgc291cmNlJyxcbiAgICB9KTtcblxuICAgIHByb3BzLmtlbmRyYUJ1Y2tldC5ncmFudFJlYWQoa2VuZHJhRGF0YVNvdXJjZVJvbGUpO1xuICAgIHByb3BzLmttc0tleS5ncmFudERlY3J5cHQoa2VuZHJhRGF0YVNvdXJjZVJvbGUpO1xuXG4gICAga2VuZHJhRGF0YVNvdXJjZVJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogWydrZW5kcmE6QmF0Y2hQdXREb2N1bWVudCcsICdrZW5kcmE6QmF0Y2hEZWxldGVEb2N1bWVudCddLFxuICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmtlbmRyYUluZGV4LmF0dHJBcm5dLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQ3JlYXRlIEtlbmRyYSBEYXRhIFNvdXJjZSBmb3IgUzNcbiAgICB0aGlzLmtlbmRyYURhdGFTb3VyY2UgPSBuZXcga2VuZHJhLkNmbkRhdGFTb3VyY2UodGhpcywgJ0tlbmRyYVMzRGF0YVNvdXJjZScsIHtcbiAgICAgIGluZGV4SWQ6IHRoaXMua2VuZHJhSW5kZXguYXR0cklkLFxuICAgICAgbmFtZTogJ0luc3RpdHV0aW9uYWxNZW1vcnlTM1NvdXJjZScsXG4gICAgICB0eXBlOiAnUzMnLFxuICAgICAgcm9sZUFybjoga2VuZHJhRGF0YVNvdXJjZVJvbGUucm9sZUFybixcbiAgICAgIGRhdGFTb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIHMzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGJ1Y2tldE5hbWU6IHByb3BzLmtlbmRyYUJ1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICAgIGluY2x1c2lvblByZWZpeGVzOiBbJ2ZpbmRpbmdzLycsICdwYXR0ZXJucy8nLCAncG9saWNpZXMvJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc2NoZWR1bGU6ICdjcm9uKDAvMTUgKiAqICogPyAqKScsIC8vIFN5bmMgZXZlcnkgMTUgbWludXRlc1xuICAgIH0pO1xuXG4gICAgdGhpcy5rZW5kcmFEYXRhU291cmNlLmFkZERlcGVuZGVuY3kodGhpcy5rZW5kcmFJbmRleCk7XG5cbiAgICAvLyA9PT09PT09PT09IE9VVFBVVFMgPT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0tlbmRyYUluZGV4SWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5rZW5kcmFJbmRleC5hdHRySWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tlbmRyYSBJbmRleCBJRCBmb3IgaW5zdGl0dXRpb25hbCBtZW1vcnknLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tS2VuZHJhSW5kZXhJZCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnS2VuZHJhSW5kZXhBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5rZW5kcmFJbmRleC5hdHRyQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLZW5kcmEgSW5kZXggQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUtlbmRyYUluZGV4QXJuJyxcbiAgICB9KTtcblxuICAgIC8vIE5vdGU6IEJlZHJvY2sgZG9lc24ndCByZXF1aXJlIGV4cGxpY2l0IENESyByZXNvdXJjZXMgYXMgaXQncyBhIG1hbmFnZWQgc2VydmljZVxuICAgIC8vIEFjY2VzcyBpcyBjb250cm9sbGVkIHZpYSBJQU0gcG9saWNpZXMgaW4gdGhlIFNlY3VyaXR5IFN0YWNrXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JlZHJvY2tOb3RlJywge1xuICAgICAgdmFsdWU6ICdCZWRyb2NrIGFjY2VzcyBjb25maWd1cmVkIHZpYSBJQU0gcG9saWNpZXMnLFxuICAgICAgZGVzY3JpcHRpb246ICdBbWF6b24gQmVkcm9jayBpcyBhY2Nlc3NlZCB2aWEgQVBJIHdpdGggSUFNIGF1dGhlbnRpY2F0aW9uJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==