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
exports.StorageStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const elasticache = __importStar(require("aws-cdk-lib/aws-elasticache"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
class StorageStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========== S3 BUCKETS ==========
        // Uploads Bucket - for incoming code submissions
        this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
            bucketName: `hivemind-uploads-${cdk.Stack.of(this).account}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: props.kmsKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            enforceSSL: true,
            lifecycleRules: [
                {
                    id: 'DeleteOldUploads',
                    prefix: 'uploads/',
                    enabled: true,
                    expiration: cdk.Duration.days(7),
                },
            ],
            eventBridgeEnabled: true, // Enable EventBridge notifications
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Artifacts Bucket - for processing and tool results
        this.artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
            bucketName: `hivemind-artifacts-${cdk.Stack.of(this).account}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: props.kmsKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            enforceSSL: true,
            lifecycleRules: [
                {
                    id: 'TransitionOldArtifacts',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: cdk.Duration.days(30),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(90),
                        },
                    ],
                },
            ],
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Kendra Memories Bucket - for institutional memory
        this.kendraBucket = new s3.Bucket(this, 'KendraBucket', {
            bucketName: `hivemind-kendra-memories-${cdk.Stack.of(this).account}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: props.kmsKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // ========== DYNAMODB TABLES ==========
        // Mission Status Table
        this.missionStatusTable = new dynamodb.Table(this, 'MissionStatusTable', {
            tableName: 'HivemindMissionStatus',
            partitionKey: {
                name: 'mission_id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: props.kmsKey,
            pointInTimeRecovery: true,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Tool Results Index Table
        this.toolResultsTable = new dynamodb.Table(this, 'ToolResultsTable', {
            tableName: 'HivemindToolResults',
            partitionKey: {
                name: 'mission_id',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'tool_timestamp',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: props.kmsKey,
            pointInTimeRecovery: true,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // Findings Archive Table
        this.findingsArchiveTable = new dynamodb.Table(this, 'FindingsArchiveTable', {
            tableName: 'HivemindFindingsArchive',
            partitionKey: {
                name: 'finding_id',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
            encryptionKey: props.kmsKey,
            pointInTimeRecovery: true,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // GSI for repo_name queries
        this.findingsArchiveTable.addGlobalSecondaryIndex({
            indexName: 'repo_name-timestamp-index',
            partitionKey: {
                name: 'repo_name',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // GSI for severity queries
        this.findingsArchiveTable.addGlobalSecondaryIndex({
            indexName: 'severity-timestamp-index',
            partitionKey: {
                name: 'severity',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // ========== ELASTICACHE REDIS ==========
        // Create subnet group for ElastiCache
        const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            description: 'Subnet group for Hivemind ElastiCache Redis',
            subnetIds: props.vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
            cacheSubnetGroupName: 'hivemind-redis-subnet-group',
        });
        // Create Redis cache cluster
        this.elastiCacheCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
            cacheNodeType: 'cache.t3.micro', // Smallest for cost optimization
            engine: 'redis',
            numCacheNodes: 1,
            cacheSubnetGroupName: subnetGroup.ref,
            vpcSecurityGroupIds: [props.elastiCacheSecurityGroup.securityGroupId],
            preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
            snapshotRetentionLimit: 0, // No snapshots = faster deletion
            autoMinorVersionUpgrade: true,
            transitEncryptionEnabled: false, // VPC isolation provides security
        });
        this.elastiCacheCluster.addDependency(subnetGroup);
        // ========== EVENTBRIDGE EVENT BUS ==========
        this.eventBus = new events.EventBus(this, 'HivemindEventBus', {
            eventBusName: 'HivemindPrism',
        });
        // CLI permissions will be granted in a separate stack to avoid circular dependency
        // Add KMS key policies for S3 and DynamoDB
        props.kmsKey.addToResourcePolicy(new iam.PolicyStatement({
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
        props.kmsKey.addToResourcePolicy(new iam.PolicyStatement({
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
        // ========== OUTPUTS ==========
        new cdk.CfnOutput(this, 'UploadsBucketName', {
            value: this.uploadsBucket.bucketName,
            description: 'S3 bucket for code uploads',
            exportName: 'HivemindPrism-UploadsBucket',
        });
        new cdk.CfnOutput(this, 'ArtifactsBucketName', {
            value: this.artifactsBucket.bucketName,
            description: 'S3 bucket for processing artifacts',
            exportName: 'HivemindPrism-ArtifactsBucket',
        });
        new cdk.CfnOutput(this, 'MissionStatusTableName', {
            value: this.missionStatusTable.tableName,
            description: 'DynamoDB table for mission status',
            exportName: 'HivemindPrism-MissionStatusTable',
        });
        new cdk.CfnOutput(this, 'FindingsArchiveTableName', {
            value: this.findingsArchiveTable.tableName,
            description: 'DynamoDB table for findings archive',
            exportName: 'HivemindPrism-FindingsArchiveTable',
        });
        new cdk.CfnOutput(this, 'RedisEndpoint', {
            value: this.elastiCacheCluster.attrRedisEndpointAddress || 'pending',
            description: 'ElastiCache Redis endpoint',
            exportName: 'HivemindPrism-RedisEndpoint',
        });
        new cdk.CfnOutput(this, 'RedisPort', {
            value: this.elastiCacheCluster.attrRedisEndpointPort || '6379',
            description: 'ElastiCache Redis port',
        });
        new cdk.CfnOutput(this, 'EventBusName', {
            value: this.eventBus.eventBusName,
            description: 'EventBridge event bus name',
            exportName: 'HivemindPrism-EventBusName',
        });
    }
}
exports.StorageStack = StorageStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9zdG9yYWdlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx1REFBeUM7QUFDekMsbUVBQXFEO0FBQ3JELHlFQUEyRDtBQUczRCwrREFBaUQ7QUFDakQseURBQTJDO0FBUzNDLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBVXpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBd0I7UUFDaEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsbUNBQW1DO1FBRW5DLGlEQUFpRDtRQUNqRCxJQUFJLENBQUMsYUFBYSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3hELFVBQVUsRUFBRSxvQkFBb0IsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFO1lBQzVELFVBQVUsRUFBRSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsR0FBRztZQUNuQyxhQUFhLEVBQUUsS0FBSyxDQUFDLE1BQU07WUFDM0IsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDakQsU0FBUyxFQUFFLElBQUk7WUFDZixVQUFVLEVBQUUsSUFBSTtZQUNoQixjQUFjLEVBQUU7Z0JBQ2Q7b0JBQ0UsRUFBRSxFQUFFLGtCQUFrQjtvQkFDdEIsTUFBTSxFQUFFLFVBQVU7b0JBQ2xCLE9BQU8sRUFBRSxJQUFJO29CQUNiLFVBQVUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7aUJBQ2pDO2FBQ0Y7WUFDRCxrQkFBa0IsRUFBRSxJQUFJLEVBQUUsbUNB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QkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFNBQVM7WUFDMUMsV0FBVyxFQUFFLHFDQUFxQztZQUNsRCxVQUFVLEVBQUUsb0NBQW9DO1NBQ2pELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsd0JBQXdCLElBQUksU0FBUztZQUNwRSxXQUFXLEVBQUUsNEJBQTRCO1lBQ3pDLFVBQVUsRUFBRSw2QkFBNkI7U0FDMUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDbkMsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxxQkFBcUIsSUFBSSxNQUFNO1lBQzlELFdBQVcsRUFBRSx3QkFBd0I7U0FDdEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtZQUNqQyxXQUFXLEVBQUUsNEJBQTRCO1lBQ3pDLFVBQVUsRUFBRSw0QkFBNEI7U0FDekMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdlFELG9DQXVRQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGVsYXN0aWNhY2hlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljYWNoZSc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTdG9yYWdlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdnBjOiBlYzIuVnBjO1xuICBrbXNLZXk6IGttcy5LZXk7XG4gIGVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG59XG5cbmV4cG9ydCBjbGFzcyBTdG9yYWdlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgdXBsb2Fkc0J1Y2tldDogczMuQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkgYXJ0aWZhY3RzQnVja2V0OiBzMy5CdWNrZXQ7XG4gIHB1YmxpYyByZWFkb25seSBrZW5kcmFCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IG1pc3Npb25TdGF0dXNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSB0b29sUmVzdWx0c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGZpbmRpbmdzQXJjaGl2ZVRhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGVsYXN0aUNhY2hlQ2x1c3RlcjogZWxhc3RpY2FjaGUuQ2ZuQ2FjaGVDbHVzdGVyO1xuICBwdWJsaWMgcmVhZG9ubHkgZXZlbnRCdXM6IGV2ZW50cy5FdmVudEJ1cztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU3RvcmFnZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT0gUzMgQlVDS0VUUyA9PT09PT09PT09XG5cbiAgICAvLyBVcGxvYWRzIEJ1Y2tldCAtIGZvciBpbmNvbWluZyBjb2RlIHN1Ym1pc3Npb25zXG4gICAgdGhpcy51cGxvYWRzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnVXBsb2Fkc0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBoaXZlbWluZC11cGxvYWRzLSR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLFxuICAgICAgZW5jcnlwdGlvbktleTogcHJvcHMua21zS2V5LFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdEZWxldGVPbGRVcGxvYWRzJyxcbiAgICAgICAgICBwcmVmaXg6ICd1cGxvYWRzLycsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg3KSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBldmVudEJyaWRnZUVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZSBFdmVudEJyaWRnZSBub3RpZmljYXRpb25zXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBBcnRpZmFjdHMgQnVja2V0IC0gZm9yIHByb2Nlc3NpbmcgYW5kIHRvb2wgcmVzdWx0c1xuICAgIHRoaXMuYXJ0aWZhY3RzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQXJ0aWZhY3RzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGhpdmVtaW5kLWFydGlmYWN0cy0ke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fWAsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHByb3BzLmttc0tleSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnVHJhbnNpdGlvbk9sZEFydGlmYWN0cycsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTlRFTExJR0VOVF9USUVSSU5HLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIEtlbmRyYSBNZW1vcmllcyBCdWNrZXQgLSBmb3IgaW5zdGl0dXRpb25hbCBtZW1vcnlcbiAgICB0aGlzLmtlbmRyYUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0tlbmRyYUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBoaXZlbWluZC1rZW5kcmEtbWVtb3JpZXMtJHtjZGsuU3RhY2sub2YodGhpcykuYWNjb3VudH1gLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gRFlOQU1PREIgVEFCTEVTID09PT09PT09PT1cblxuICAgIC8vIE1pc3Npb24gU3RhdHVzIFRhYmxlXG4gICAgdGhpcy5taXNzaW9uU3RhdHVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ01pc3Npb25TdGF0dXNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0hpdmVtaW5kTWlzc2lvblN0YXR1cycsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ21pc3Npb25faWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIFRvb2wgUmVzdWx0cyBJbmRleCBUYWJsZVxuICAgIHRoaXMudG9vbFJlc3VsdHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVG9vbFJlc3VsdHNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0hpdmVtaW5kVG9vbFJlc3VsdHMnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdtaXNzaW9uX2lkJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAndG9vbF90aW1lc3RhbXAnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBGaW5kaW5ncyBBcmNoaXZlIFRhYmxlXG4gICAgdGhpcy5maW5kaW5nc0FyY2hpdmVUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnRmluZGluZ3NBcmNoaXZlVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdIaXZlbWluZEZpbmRpbmdzQXJjaGl2ZScsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ2ZpbmRpbmdfaWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUixcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgZm9yIHJlcG9fbmFtZSBxdWVyaWVzXG4gICAgdGhpcy5maW5kaW5nc0FyY2hpdmVUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdyZXBvX25hbWUtdGltZXN0YW1wLWluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAncmVwb19uYW1lJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIsXG4gICAgICB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBmb3Igc2V2ZXJpdHkgcXVlcmllc1xuICAgIHRoaXMuZmluZGluZ3NBcmNoaXZlVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnc2V2ZXJpdHktdGltZXN0YW1wLWluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAnc2V2ZXJpdHknLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUixcbiAgICAgIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PSBFTEFTVElDQUNIRSBSRURJUyA9PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgc3VibmV0IGdyb3VwIGZvciBFbGFzdGlDYWNoZVxuICAgIGNvbnN0IHN1Ym5ldEdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblN1Ym5ldEdyb3VwKHRoaXMsICdSZWRpc1N1Ym5ldEdyb3VwJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdWJuZXQgZ3JvdXAgZm9yIEhpdmVtaW5kIEVsYXN0aUNhY2hlIFJlZGlzJyxcbiAgICAgIHN1Ym5ldElkczogcHJvcHMudnBjLmlzb2xhdGVkU3VibmV0cy5tYXAoKHN1Ym5ldDogZWMyLklTdWJuZXQpID0+IHN1Ym5ldC5zdWJuZXRJZCksXG4gICAgICBjYWNoZVN1Ym5ldEdyb3VwTmFtZTogJ2hpdmVtaW5kLXJlZGlzLXN1Ym5ldC1ncm91cCcsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgUmVkaXMgY2FjaGUgY2x1c3RlclxuICAgIHRoaXMuZWxhc3RpQ2FjaGVDbHVzdGVyID0gbmV3IGVsYXN0aWNhY2hlLkNmbkNhY2hlQ2x1c3Rlcih0aGlzLCAnUmVkaXNDbHVzdGVyJywge1xuICAgICAgY2FjaGVOb2RlVHlwZTogJ2NhY2hlLnQzLm1pY3JvJywgLy8gU21hbGxlc3QgZm9yIGNvc3Qgb3B0aW1pemF0aW9uXG4gICAgICBlbmdpbmU6ICdyZWRpcycsXG4gICAgICBudW1DYWNoZU5vZGVzOiAxLFxuICAgICAgY2FjaGVTdWJuZXRHcm91cE5hbWU6IHN1Ym5ldEdyb3VwLnJlZixcbiAgICAgIHZwY1NlY3VyaXR5R3JvdXBJZHM6IFtwcm9wcy5lbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkXSxcbiAgICAgIHByZWZlcnJlZE1haW50ZW5hbmNlV2luZG93OiAnc3VuOjA1OjAwLXN1bjowNjowMCcsXG4gICAgICBzbmFwc2hvdFJldGVudGlvbkxpbWl0OiAwLCAvLyBObyBzbmFwc2hvdHMgPSBmYXN0ZXIgZGVsZXRpb25cbiAgICAgIGF1dG9NaW5vclZlcnNpb25VcGdyYWRlOiB0cnVlLFxuICAgICAgdHJhbnNpdEVuY3J5cHRpb25FbmFibGVkOiBmYWxzZSwgLy8gVlBDIGlzb2xhdGlvbiBwcm92aWRlcyBzZWN1cml0eVxuICAgIH0pO1xuXG4gICAgdGhpcy5lbGFzdGlDYWNoZUNsdXN0ZXIuYWRkRGVwZW5kZW5jeShzdWJuZXRHcm91cCk7XG5cbiAgICAvLyA9PT09PT09PT09IEVWRU5UQlJJREdFIEVWRU5UIEJVUyA9PT09PT09PT09XG5cbiAgICB0aGlzLmV2ZW50QnVzID0gbmV3IGV2ZW50cy5FdmVudEJ1cyh0aGlzLCAnSGl2ZW1pbmRFdmVudEJ1cycsIHtcbiAgICAgIGV2ZW50QnVzTmFtZTogJ0hpdmVtaW5kUHJpc20nLFxuICAgIH0pO1xuXG4gICAgLy8gQ0xJIHBlcm1pc3Npb25zIHdpbGwgYmUgZ3JhbnRlZCBpbiBhIHNlcGFyYXRlIHN0YWNrIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY3lcbiAgICBcbiAgICAvLyBBZGQgS01TIGtleSBwb2xpY2llcyBmb3IgUzMgYW5kIER5bmFtb0RCXG4gICAgcHJvcHMua21zS2V5LmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0FsbG93IFMzIHRvIHVzZSBrZXknLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFtuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3MzLmFtYXpvbmF3cy5jb20nKV0sXG4gICAgICAgIGFjdGlvbnM6IFsna21zOkRlY3J5cHQnLCAna21zOkdlbmVyYXRlRGF0YUtleSddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAna21zOlZpYVNlcnZpY2UnOiBgczMuJHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufS5hbWF6b25hd3MuY29tYCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgcHJvcHMua21zS2V5LmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogJ0FsbG93IER5bmFtb0RCIHRvIHVzZSBrZXknLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFtuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2R5bmFtb2RiLmFtYXpvbmF3cy5jb20nKV0sXG4gICAgICAgIGFjdGlvbnM6IFsna21zOkRlY3J5cHQnLCAna21zOkRlc2NyaWJlS2V5JywgJ2ttczpDcmVhdGVHcmFudCddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAna21zOlZpYVNlcnZpY2UnOiBgZHluYW1vZGIuJHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufS5hbWF6b25hd3MuY29tYCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PSBPVVRQVVRTID09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVcGxvYWRzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVwbG9hZHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IGZvciBjb2RlIHVwbG9hZHMnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tVXBsb2Fkc0J1Y2tldCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXJ0aWZhY3RzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFydGlmYWN0c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTMyBidWNrZXQgZm9yIHByb2Nlc3NpbmcgYXJ0aWZhY3RzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUFydGlmYWN0c0J1Y2tldCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTWlzc2lvblN0YXR1c1RhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm1pc3Npb25TdGF0dXNUYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIHRhYmxlIGZvciBtaXNzaW9uIHN0YXR1cycsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1NaXNzaW9uU3RhdHVzVGFibGUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0ZpbmRpbmdzQXJjaGl2ZVRhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmZpbmRpbmdzQXJjaGl2ZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgdGFibGUgZm9yIGZpbmRpbmdzIGFyY2hpdmUnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tRmluZGluZ3NBcmNoaXZlVGFibGUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZGlzRW5kcG9pbnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lbGFzdGlDYWNoZUNsdXN0ZXIuYXR0clJlZGlzRW5kcG9pbnRBZGRyZXNzIHx8ICdwZW5kaW5nJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgZW5kcG9pbnQnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tUmVkaXNFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNQb3J0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuZWxhc3RpQ2FjaGVDbHVzdGVyLmF0dHJSZWRpc0VuZHBvaW50UG9ydCB8fCAnNjM3OScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0VsYXN0aUNhY2hlIFJlZGlzIHBvcnQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0V2ZW50QnVzTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2UgZXZlbnQgYnVzIG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tRXZlbnRCdXNOYW1lJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==