import * as cdk from 'aws-cdk-lib';
import * as kendra from 'aws-cdk-lib/aws-kendra';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export interface IntelligenceStackProps extends cdk.StackProps {
  kendraBucket: s3.Bucket;
  kmsKey: kms.Key;
}

export class IntelligenceStack extends cdk.Stack {
  public readonly kendraIndex: kendra.CfnIndex;
  public readonly kendraDataSource: kendra.CfnDataSource;

  constructor(scope: Construct, id: string, props: IntelligenceStackProps) {
    super(scope, id, props);

    // ========== KENDRA INDEX ==========

    // Create IAM role for Kendra Index
    const kendraIndexRole = new iam.Role(this, 'KendraIndexRole', {
      assumedBy: new iam.ServicePrincipal('kendra.amazonaws.com'),
      description: 'Role for Kendra index operations',
    });

    kendraIndexRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'AWS/Kendra',
          },
        },
      })
    );

    kendraIndexRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/kendra/*`,
        ],
      })
    );

    // Create Kendra Index
    this.kendraIndex = new kendra.CfnIndex(this, 'InstitutionalMemoryIndex', {
      name: 'HivemindInstitutionalMemory',
      edition: 'DEVELOPER_EDITION', // Enterprise for production
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

    kendraDataSourceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kendra:BatchPutDocument', 'kendra:BatchDeleteDocument'],
        resources: [this.kendraIndex.attrArn],
      })
    );

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