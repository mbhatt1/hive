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
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(1),
                        },
                    ],
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
            subnetIds: props.vpc.privateSubnets.map((subnet) => subnet.subnetId),
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
            snapshotRetentionLimit: 7,
            autoMinorVersionUpgrade: true,
            transitEncryptionEnabled: false, // VPC isolation provides security
        });
        this.elastiCacheCluster.addDependency(subnetGroup);
        // ========== EVENTBRIDGE EVENT BUS ==========
        this.eventBus = new events.EventBus(this, 'HivemindEventBus', {
            eventBusName: 'HivemindPrism',
        });
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
            value: this.elastiCacheCluster.attrRedisEndpointAddress,
            description: 'ElastiCache Redis endpoint',
            exportName: 'HivemindPrism-RedisEndpoint',
        });
        new cdk.CfnOutput(this, 'RedisPort', {
            value: this.elastiCacheCluster.attrRedisEndpointPort,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmFnZS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9zdG9yYWdlLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx1REFBeUM7QUFDekMsbUVBQXFEO0FBQ3JELHlFQUEyRDtBQUczRCwrREFBaUQ7QUFTakQsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFVekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF3QjtRQUNoRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixtQ0FBbUM7UUFFbkMsaURBQWlEO1FBQ2pELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDeEQsVUFBVSxFQUFFLG9CQUFvQixHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxPQUFPLEVBQUU7WUFDNUQsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHO1lBQ25DLGFBQWEsRUFBRSxLQUFLLENBQUMsTUFBTTtZQUMzQixpQkFBaUIsRUFBRSxFQUFFLENBQUMsaUJBQWlCLENBQUMsU0FBUztZQUNqRCxTQUFTLEVBQUUsSUFBSTtZQUNmLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLGNBQWMsRUFBRTtnQkFDZDtvQkFDRSxFQUFFLEVBQUUsa0JBQWtCO29CQUN0QixNQUFNLEVBQUUsVUFBVTtvQkFDbEIsT0FBTyxFQUFFLElBQUk7b0JBQ2IsV0FBVyxFQUFFO3dCQUNYOzRCQUNFLFlBQVksRUFBRSxFQUFFLENBQUMsWUFBWSxDQUFDLGlCQUFpQjs0QkFDL0MsZUFBZSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFD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LEVBQUU7WUFDaEQsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxTQUFTO1lBQ3hDLFdBQVcsRUFBRSxtQ0FBbUM7WUFDaEQsVUFBVSxFQUFFLGtDQUFrQztTQUMvQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2xELEtBQUssRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsU0FBUztZQUMxQyxXQUFXLEVBQUUscUNBQXFDO1lBQ2xELFVBQVUsRUFBRSxvQ0FBb0M7U0FDakQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyx3QkFBd0I7WUFDdkQsV0FBVyxFQUFFLDRCQUE0QjtZQUN6QyxVQUFVLEVBQUUsNkJBQTZCO1NBQzFDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ25DLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMscUJBQXFCO1lBQ3BELFdBQVcsRUFBRSx3QkFBd0I7U0FDdEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtZQUNqQyxXQUFXLEVBQUUsNEJBQTRCO1lBQ3pDLFVBQVUsRUFBRSw0QkFBNEI7U0FDekMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBNU9ELG9DQTRPQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGVsYXN0aWNhY2hlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljYWNoZSc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBTdG9yYWdlU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdnBjOiBlYzIuVnBjO1xuICBrbXNLZXk6IGttcy5LZXk7XG4gIGVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG59XG5cbmV4cG9ydCBjbGFzcyBTdG9yYWdlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgdXBsb2Fkc0J1Y2tldDogczMuQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkgYXJ0aWZhY3RzQnVja2V0OiBzMy5CdWNrZXQ7XG4gIHB1YmxpYyByZWFkb25seSBrZW5kcmFCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IG1pc3Npb25TdGF0dXNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSB0b29sUmVzdWx0c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGZpbmRpbmdzQXJjaGl2ZVRhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGVsYXN0aUNhY2hlQ2x1c3RlcjogZWxhc3RpY2FjaGUuQ2ZuQ2FjaGVDbHVzdGVyO1xuICBwdWJsaWMgcmVhZG9ubHkgZXZlbnRCdXM6IGV2ZW50cy5FdmVudEJ1cztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU3RvcmFnZVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT0gUzMgQlVDS0VUUyA9PT09PT09PT09XG5cbiAgICAvLyBVcGxvYWRzIEJ1Y2tldCAtIGZvciBpbmNvbWluZyBjb2RlIHN1Ym1pc3Npb25zXG4gICAgdGhpcy51cGxvYWRzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnVXBsb2Fkc0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBoaXZlbWluZC11cGxvYWRzLSR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uS01TLFxuICAgICAgZW5jcnlwdGlvbktleTogcHJvcHMua21zS2V5LFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdEZWxldGVPbGRVcGxvYWRzJyxcbiAgICAgICAgICBwcmVmaXg6ICd1cGxvYWRzLycsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygxKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cyg3KSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBldmVudEJyaWRnZUVuYWJsZWQ6IHRydWUsIC8vIEVuYWJsZSBFdmVudEJyaWRnZSBub3RpZmljYXRpb25zXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBBcnRpZmFjdHMgQnVja2V0IC0gZm9yIHByb2Nlc3NpbmcgYW5kIHRvb2wgcmVzdWx0c1xuICAgIHRoaXMuYXJ0aWZhY3RzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQXJ0aWZhY3RzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGhpdmVtaW5kLWFydGlmYWN0cy0ke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fWAsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IHByb3BzLmttc0tleSxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnVHJhbnNpdGlvbk9sZEFydGlmYWN0cycsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTlRFTExJR0VOVF9USUVSSU5HLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIEtlbmRyYSBNZW1vcmllcyBCdWNrZXQgLSBmb3IgaW5zdGl0dXRpb25hbCBtZW1vcnlcbiAgICB0aGlzLmtlbmRyYUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0tlbmRyYUJ1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBoaXZlbWluZC1rZW5kcmEtbWVtb3JpZXMtJHtjZGsuU3RhY2sub2YodGhpcykuYWNjb3VudH1gLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gRFlOQU1PREIgVEFCTEVTID09PT09PT09PT1cblxuICAgIC8vIE1pc3Npb24gU3RhdHVzIFRhYmxlXG4gICAgdGhpcy5taXNzaW9uU3RhdHVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ01pc3Npb25TdGF0dXNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0hpdmVtaW5kTWlzc2lvblN0YXR1cycsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ21pc3Npb25faWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIC8vIFRvb2wgUmVzdWx0cyBJbmRleCBUYWJsZVxuICAgIHRoaXMudG9vbFJlc3VsdHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVG9vbFJlc3VsdHNUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ0hpdmVtaW5kVG9vbFJlc3VsdHMnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdtaXNzaW9uX2lkJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAndG9vbF90aW1lc3RhbXAnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBGaW5kaW5ncyBBcmNoaXZlIFRhYmxlXG4gICAgdGhpcy5maW5kaW5nc0FyY2hpdmVUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnRmluZGluZ3NBcmNoaXZlVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdIaXZlbWluZEZpbmRpbmdzQXJjaGl2ZScsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ2ZpbmRpbmdfaWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUixcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9wcy5rbXNLZXksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgZm9yIHJlcG9fbmFtZSBxdWVyaWVzXG4gICAgdGhpcy5maW5kaW5nc0FyY2hpdmVUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdyZXBvX25hbWUtdGltZXN0YW1wLWluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAncmVwb19uYW1lJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIsXG4gICAgICB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIEdTSSBmb3Igc2V2ZXJpdHkgcXVlcmllc1xuICAgIHRoaXMuZmluZGluZ3NBcmNoaXZlVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnc2V2ZXJpdHktdGltZXN0YW1wLWluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAnc2V2ZXJpdHknLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUixcbiAgICAgIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PSBFTEFTVElDQUNIRSBSRURJUyA9PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgc3VibmV0IGdyb3VwIGZvciBFbGFzdGlDYWNoZVxuICAgIGNvbnN0IHN1Ym5ldEdyb3VwID0gbmV3IGVsYXN0aWNhY2hlLkNmblN1Ym5ldEdyb3VwKHRoaXMsICdSZWRpc1N1Ym5ldEdyb3VwJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdWJuZXQgZ3JvdXAgZm9yIEhpdmVtaW5kIEVsYXN0aUNhY2hlIFJlZGlzJyxcbiAgICAgIHN1Ym5ldElkczogcHJvcHMudnBjLnByaXZhdGVTdWJuZXRzLm1hcCgoc3VibmV0OiBlYzIuSVN1Ym5ldCkgPT4gc3VibmV0LnN1Ym5ldElkKSxcbiAgICAgIGNhY2hlU3VibmV0R3JvdXBOYW1lOiAnaGl2ZW1pbmQtcmVkaXMtc3VibmV0LWdyb3VwJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBSZWRpcyBjYWNoZSBjbHVzdGVyXG4gICAgdGhpcy5lbGFzdGlDYWNoZUNsdXN0ZXIgPSBuZXcgZWxhc3RpY2FjaGUuQ2ZuQ2FjaGVDbHVzdGVyKHRoaXMsICdSZWRpc0NsdXN0ZXInLCB7XG4gICAgICBjYWNoZU5vZGVUeXBlOiAnY2FjaGUudDMubWljcm8nLCAvLyBTbWFsbGVzdCBmb3IgY29zdCBvcHRpbWl6YXRpb25cbiAgICAgIGVuZ2luZTogJ3JlZGlzJyxcbiAgICAgIG51bUNhY2hlTm9kZXM6IDEsXG4gICAgICBjYWNoZVN1Ym5ldEdyb3VwTmFtZTogc3VibmV0R3JvdXAucmVmLFxuICAgICAgdnBjU2VjdXJpdHlHcm91cElkczogW3Byb3BzLmVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWRdLFxuICAgICAgcHJlZmVycmVkTWFpbnRlbmFuY2VXaW5kb3c6ICdzdW46MDU6MDAtc3VuOjA2OjAwJyxcbiAgICAgIHNuYXBzaG90UmV0ZW50aW9uTGltaXQ6IDcsXG4gICAgICBhdXRvTWlub3JWZXJzaW9uVXBncmFkZTogdHJ1ZSxcbiAgICAgIHRyYW5zaXRFbmNyeXB0aW9uRW5hYmxlZDogZmFsc2UsIC8vIFZQQyBpc29sYXRpb24gcHJvdmlkZXMgc2VjdXJpdHlcbiAgICB9KTtcblxuICAgIHRoaXMuZWxhc3RpQ2FjaGVDbHVzdGVyLmFkZERlcGVuZGVuY3koc3VibmV0R3JvdXApO1xuXG4gICAgLy8gPT09PT09PT09PSBFVkVOVEJSSURHRSBFVkVOVCBCVVMgPT09PT09PT09PVxuXG4gICAgdGhpcy5ldmVudEJ1cyA9IG5ldyBldmVudHMuRXZlbnRCdXModGhpcywgJ0hpdmVtaW5kRXZlbnRCdXMnLCB7XG4gICAgICBldmVudEJ1c05hbWU6ICdIaXZlbWluZFByaXNtJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gT1VUUFVUUyA9PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXBsb2Fkc0J1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy51cGxvYWRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIGJ1Y2tldCBmb3IgY29kZSB1cGxvYWRzJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLVVwbG9hZHNCdWNrZXQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FydGlmYWN0c0J1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcnRpZmFjdHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IGZvciBwcm9jZXNzaW5nIGFydGlmYWN0cycsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1BcnRpZmFjdHNCdWNrZXQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ01pc3Npb25TdGF0dXNUYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5taXNzaW9uU3RhdHVzVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiB0YWJsZSBmb3IgbWlzc2lvbiBzdGF0dXMnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tTWlzc2lvblN0YXR1c1RhYmxlJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdGaW5kaW5nc0FyY2hpdmVUYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5maW5kaW5nc0FyY2hpdmVUYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIHRhYmxlIGZvciBmaW5kaW5ncyBhcmNoaXZlJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUZpbmRpbmdzQXJjaGl2ZVRhYmxlJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWRpc0VuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMuZWxhc3RpQ2FjaGVDbHVzdGVyLmF0dHJSZWRpc0VuZHBvaW50QWRkcmVzcyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgZW5kcG9pbnQnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tUmVkaXNFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVkaXNQb3J0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuZWxhc3RpQ2FjaGVDbHVzdGVyLmF0dHJSZWRpc0VuZHBvaW50UG9ydCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRWxhc3RpQ2FjaGUgUmVkaXMgcG9ydCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRXZlbnRCdXNOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFdmVudEJyaWRnZSBldmVudCBidXMgbmFtZScsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1FdmVudEJ1c05hbWUnLFxuICAgIH0pO1xuICB9XG59Il19