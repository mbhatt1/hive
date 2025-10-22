import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface StorageStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  kmsKey: kms.Key;
  elastiCacheSecurityGroup: ec2.SecurityGroup;
}

export class StorageStack extends cdk.Stack {
  public readonly uploadsBucket: s3.Bucket;
  public readonly artifactsBucket: s3.Bucket;
  public readonly kendraBucket: s3.Bucket;
  public readonly missionStatusTable: dynamodb.Table;
  public readonly toolResultsTable: dynamodb.Table;
  public readonly findingsArchiveTable: dynamodb.Table;
  public readonly elastiCacheCluster: elasticache.CfnCacheCluster;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // ========== S3 BUCKETS ==========

    // Uploads Bucket - for incoming code submissions
    const uploadsBucketName = `hivemind-uploads-${cdk.Stack.of(this).account}`;
    this.uploadsBucket = s3.Bucket.fromBucketName(this, 'UploadsBucketImport', uploadsBucketName) as s3.Bucket ||
      new s3.Bucket(this, 'UploadsBucket', {
        bucketName: uploadsBucketName,
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
        eventBridgeEnabled: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

    // Artifacts Bucket - for processing and tool results
    const artifactsBucketName = `hivemind-artifacts-${cdk.Stack.of(this).account}`;
    this.artifactsBucket = s3.Bucket.fromBucketName(this, 'ArtifactsBucketImport', artifactsBucketName) as s3.Bucket ||
      new s3.Bucket(this, 'ArtifactsBucket', {
        bucketName: artifactsBucketName,
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
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

    // Kendra Memories Bucket - for institutional memory
    const kendraBucketName = `hivemind-kendra-memories-${cdk.Stack.of(this).account}`;
    this.kendraBucket = s3.Bucket.fromBucketName(this, 'KendraBucketImport', kendraBucketName) as s3.Bucket ||
      new s3.Bucket(this, 'KendraBucket', {
        bucketName: kendraBucketName,
        encryption: s3.BucketEncryption.KMS,
        encryptionKey: props.kmsKey,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        versioned: true,
        enforceSSL: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });

    // ========== DYNAMODB TABLES ==========

    // Mission Status Table
    const missionStatusTableName = `HivemindMissionStatus-${cdk.Stack.of(this).account}`;
    try {
      this.missionStatusTable = dynamodb.Table.fromTableName(this, 'MissionStatusTableImport', missionStatusTableName) as dynamodb.Table;
    } catch {
      this.missionStatusTable = new dynamodb.Table(this, 'MissionStatusTable', {
        tableName: missionStatusTableName,
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
    }

    // Tool Results Index Table
    const toolResultsTableName = `HivemindToolResults-${cdk.Stack.of(this).account}`;
    try {
      this.toolResultsTable = dynamodb.Table.fromTableName(this, 'ToolResultsTableImport', toolResultsTableName) as dynamodb.Table;
    } catch {
      this.toolResultsTable = new dynamodb.Table(this, 'ToolResultsTable', {
        tableName: toolResultsTableName,
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
    }

    // Findings Archive Table
    const findingsArchiveTableName = `HivemindFindingsArchive-${cdk.Stack.of(this).account}`;
    const findingsTableExists = this.node.tryGetContext('findingsTableExists') === 'true';
    
    if (findingsTableExists) {
      this.findingsArchiveTable = dynamodb.Table.fromTableName(this, 'FindingsArchiveTableImport', findingsArchiveTableName) as dynamodb.Table;
    } else {
      this.findingsArchiveTable = new dynamodb.Table(this, 'FindingsArchiveTable', {
        tableName: findingsArchiveTableName,
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
    }

    // ========== ELASTICACHE REDIS ==========

    // Create subnet group for ElastiCache
    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Hivemind ElastiCache Redis',
      subnetIds: props.vpc.isolatedSubnets.map((subnet: ec2.ISubnet) => subnet.subnetId),
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
    props.kmsKey.addToResourcePolicy(
      new iam.PolicyStatement({
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
      })
    );

    props.kmsKey.addToResourcePolicy(
      new iam.PolicyStatement({
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
      })
    );

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