import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly isolatedSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC with isolated subnets only (no NAT gateway to avoid EIP limit)
    // AWS services accessed via VPC endpoints
    this.vpc = new ec2.Vpc(this, 'HivemindVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      maxAzs: 1,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    this.privateSubnets = this.vpc.isolatedSubnets; // Using isolated subnets as private
    this.isolatedSubnets = this.vpc.isolatedSubnets;

    // Add VPC Gateway Endpoints for S3 and DynamoDB (no cost, better performance)
    // Must include BOTH PRIVATE_WITH_EGRESS (where agents run) and PRIVATE_ISOLATED (where lambdas run)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [
        { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    // Create security group for VPC endpoints
    const vpcEndpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for VPC interface endpoints',
      allowAllOutbound: false,
    });

    // Allow HTTPS traffic from private subnets
    vpcEndpointSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC'
    );

    // Add VPC Interface Endpoints for AWS services
    const interfaceEndpoints = [
      {
        name: 'EcrApi',
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
      },
      {
        name: 'EcrDocker',
        service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      },
      {
        name: 'CloudWatchLogs',
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      },
      {
        name: 'SecretsManager',
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      },
      {
        name: 'Sts',
        service: ec2.InterfaceVpcEndpointAwsService.STS,
      },
      {
        name: 'StepFunctions',
        service: ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS,
      },
      {
        name: 'EventBridge',
        service: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE,
      },
      {
        name: 'Sns',
        service: ec2.InterfaceVpcEndpointAwsService.SNS,
      },
      {
        name: 'Kms',
        service: ec2.InterfaceVpcEndpointAwsService.KMS,
      },
      {
        name: 'Lambda',
        service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
      },
      {
        name: 'Kendra',
        service: ec2.InterfaceVpcEndpointAwsService.KENDRA,
      },
    ];

    // Interface endpoints - deploy to BOTH subnet types
    // Agents run in PRIVATE_WITH_EGRESS, Lambdas run in PRIVATE_ISOLATED
    interfaceEndpoints.forEach((endpoint) => {
      this.vpc.addInterfaceEndpoint(endpoint.name, {
        service: endpoint.service,
        privateDnsEnabled: true,
        securityGroups: [vpcEndpointSecurityGroup],
      });
    });

    // Add Bedrock endpoint (custom service endpoint)
    this.vpc.addInterfaceEndpoint('BedrockRuntime', {
      service: new ec2.InterfaceVpcEndpointService(
        `com.amazonaws.${cdk.Stack.of(this).region}.bedrock-runtime`,
        443
      ),
      privateDnsEnabled: true,
      securityGroups: [vpcEndpointSecurityGroup],
    });

    // Add CloudWatch Monitoring endpoint
    this.vpc.addInterfaceEndpoint('CloudWatchMonitoring', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
      privateDnsEnabled: true,
      securityGroups: [vpcEndpointSecurityGroup],
    });

    // Add X-Ray endpoint for distributed tracing
    this.vpc.addInterfaceEndpoint('XRay', {
      service: ec2.InterfaceVpcEndpointAwsService.XRAY,
      privateDnsEnabled: true,
      securityGroups: [vpcEndpointSecurityGroup],
    });

    // Tag VPC and subnets
    cdk.Tags.of(this.vpc).add('Name', 'HivemindPrism-VPC');
    cdk.Tags.of(this.vpc).add('SecurityLevel', 'High');

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for Hivemind-Prism',
      exportName: 'HivemindPrism-VpcId',
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR block',
    });
  }
}