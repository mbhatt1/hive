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
exports.NetworkStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
class NetworkStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create VPC with isolated subnets only (no NAT gateway to avoid EIP limit)
        // AWS services accessed via VPC endpoints
        this.vpc = new ec2.Vpc(this, 'HivemindVpc', {
            ipAddresses: ec2.IpAddresses.cidr('10.10.0.0/16'),
            maxAzs: 1,
            natGateways: 0, // No NAT gateway - use VPC endpoints instead
            subnetConfiguration: [
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
        this.vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [
                { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            ],
        });
        this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
            subnets: [
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
        vpcEndpointSecurityGroup.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(443), 'Allow HTTPS from VPC');
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
        ];
        interfaceEndpoints.forEach((endpoint) => {
            this.vpc.addInterfaceEndpoint(endpoint.name, {
                service: endpoint.service,
                privateDnsEnabled: true,
                securityGroups: [vpcEndpointSecurityGroup],
                subnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
            });
        });
        // Add Bedrock endpoint (custom service endpoint)
        this.vpc.addInterfaceEndpoint('BedrockRuntime', {
            service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${cdk.Stack.of(this).region}.bedrock-runtime`, 443),
            privateDnsEnabled: true,
            securityGroups: [vpcEndpointSecurityGroup],
            subnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
        });
        // Add CloudWatch Monitoring endpoint
        this.vpc.addInterfaceEndpoint('CloudWatchMonitoring', {
            service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
            privateDnsEnabled: true,
            securityGroups: [vpcEndpointSecurityGroup],
            subnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
        });
        // Add X-Ray endpoint for distributed tracing
        this.vpc.addInterfaceEndpoint('XRay', {
            service: ec2.InterfaceVpcEndpointAwsService.XRAY,
            privateDnsEnabled: true,
            securityGroups: [vpcEndpointSecurityGroup],
            subnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
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
exports.NetworkStack = NetworkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmV0d29yay1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9uZXR3b3JrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFHM0MsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFLekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw0RUFBNEU7UUFDNUUsMENBQTBDO1FBQzFDLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDMUMsV0FBVyxFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQztZQUNqRCxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDLEVBQUUsNkNBQTZDO1lBQzdELG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxJQUFJLEVBQUUsVUFBVTtvQkFDaEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCO29CQUMzQyxRQUFRLEVBQUUsRUFBRTtpQkFDYjthQUNGO1lBQ0Qsa0JBQWtCLEVBQUUsSUFBSTtZQUN4QixnQkFBZ0IsRUFBRSxJQUFJO1NBQ3ZCLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxvQ0FBb0M7UUFDcEYsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQztRQUVoRCw4RUFBOEU7UUFDOUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxZQUFZLEVBQUU7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RCxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDL0IsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSztZQUNyQixXQUFXLEVBQUUsMkJBQTJCO1lBQ3hDLFVBQVUsRUFBRSxxQkFBcUI7U0FDbEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDakMsS0FBSyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsWUFBWTtZQUM1QixXQUFXLEVBQUUsZ0JBQWdCO1NBQzlCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdKRCxvQ0E2SkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBjbGFzcyBOZXR3b3JrU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgdnBjOiBlYzIuVnBjO1xuICBwdWJsaWMgcmVhZG9ubHkgcHJpdmF0ZVN1Ym5ldHM6IGVjMi5JU3VibmV0W107XG4gIHB1YmxpYyByZWFkb25seSBpc29sYXRlZFN1Ym5ldHM6IGVjMi5JU3VibmV0W107XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gQ3JlYXRlIFZQQyB3aXRoIGlzb2xhdGVkIHN1Ym5ldHMgb25seSAobm8gTkFUIGdhdGV3YXkgdG8gYXZvaWQgRUlQIGxpbWl0KVxuICAgIC8vIEFXUyBzZXJ2aWNlcyBhY2Nlc3NlZCB2aWEgVlBDIGVuZHBvaW50c1xuICAgIHRoaXMudnBjID0gbmV3IGVjMi5WcGModGhpcywgJ0hpdmVtaW5kVnBjJywge1xuICAgICAgaXBBZGRyZXNzZXM6IGVjMi5JcEFkZHJlc3Nlcy5jaWRyKCcxMC4xMC4wLjAvMTYnKSxcbiAgICAgIG1heEF6czogMSxcbiAgICAgIG5hdEdhdGV3YXlzOiAwLCAvLyBObyBOQVQgZ2F0ZXdheSAtIHVzZSBWUEMgZW5kcG9pbnRzIGluc3RlYWRcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdJc29sYXRlZCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZW5hYmxlRG5zSG9zdG5hbWVzOiB0cnVlLFxuICAgICAgZW5hYmxlRG5zU3VwcG9ydDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIHRoaXMucHJpdmF0ZVN1Ym5ldHMgPSB0aGlzLnZwYy5pc29sYXRlZFN1Ym5ldHM7IC8vIFVzaW5nIGlzb2xhdGVkIHN1Ym5ldHMgYXMgcHJpdmF0ZVxuICAgIHRoaXMuaXNvbGF0ZWRTdWJuZXRzID0gdGhpcy52cGMuaXNvbGF0ZWRTdWJuZXRzO1xuXG4gICAgLy8gQWRkIFZQQyBHYXRld2F5IEVuZHBvaW50cyBmb3IgUzMgYW5kIER5bmFtb0RCIChubyBjb3N0LCBiZXR0ZXIgcGVyZm9ybWFuY2UpXG4gICAgdGhpcy52cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdTM0VuZHBvaW50Jywge1xuICAgICAgc2VydmljZTogZWMyLkdhdGV3YXlWcGNFbmRwb2ludEF3c1NlcnZpY2UuUzMsXG4gICAgICBzdWJuZXRzOiBbXG4gICAgICAgIHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIHRoaXMudnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnRHluYW1vRGJFbmRwb2ludCcsIHtcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCLFxuICAgICAgc3VibmV0czogW1xuICAgICAgICB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgc2VjdXJpdHkgZ3JvdXAgZm9yIFZQQyBlbmRwb2ludHNcbiAgICBjb25zdCB2cGNFbmRwb2ludFNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1ZwY0VuZHBvaW50U2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBWUEMgaW50ZXJmYWNlIGVuZHBvaW50cycsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiBmYWxzZSxcbiAgICB9KTtcblxuICAgIC8vIEFsbG93IEhUVFBTIHRyYWZmaWMgZnJvbSBwcml2YXRlIHN1Ym5ldHNcbiAgICB2cGNFbmRwb2ludFNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBlYzIuUGVlci5pcHY0KHRoaXMudnBjLnZwY0NpZHJCbG9jayksXG4gICAgICBlYzIuUG9ydC50Y3AoNDQzKSxcbiAgICAgICdBbGxvdyBIVFRQUyBmcm9tIFZQQydcbiAgICApO1xuXG4gICAgLy8gQWRkIFZQQyBJbnRlcmZhY2UgRW5kcG9pbnRzIGZvciBBV1Mgc2VydmljZXNcbiAgICBjb25zdCBpbnRlcmZhY2VFbmRwb2ludHMgPSBbXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdFY3JBcGknLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkVDUixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdFY3JEb2NrZXInLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkVDUl9ET0NLRVIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBuYW1lOiAnQ2xvdWRXYXRjaExvZ3MnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkNMT1VEV0FUQ0hfTE9HUyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdTZWNyZXRzTWFuYWdlcicsXG4gICAgICAgIHNlcnZpY2U6IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludEF3c1NlcnZpY2UuU0VDUkVUU19NQU5BR0VSLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ1N0cycsXG4gICAgICAgIHNlcnZpY2U6IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludEF3c1NlcnZpY2UuU1RTLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ1N0ZXBGdW5jdGlvbnMnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlNURVBfRlVOQ1RJT05TLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ0V2ZW50QnJpZGdlJyxcbiAgICAgICAgc2VydmljZTogZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5FVkVOVEJSSURHRSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdTbnMnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlNOUyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdLbXMnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLktNUyxcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIGludGVyZmFjZUVuZHBvaW50cy5mb3JFYWNoKChlbmRwb2ludCkgPT4ge1xuICAgICAgdGhpcy52cGMuYWRkSW50ZXJmYWNlRW5kcG9pbnQoZW5kcG9pbnQubmFtZSwge1xuICAgICAgICBzZXJ2aWNlOiBlbmRwb2ludC5zZXJ2aWNlLFxuICAgICAgICBwcml2YXRlRG5zRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IFt2cGNFbmRwb2ludFNlY3VyaXR5R3JvdXBdLFxuICAgICAgICBzdWJuZXRzOiB7XG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIEJlZHJvY2sgZW5kcG9pbnQgKGN1c3RvbSBzZXJ2aWNlIGVuZHBvaW50KVxuICAgIHRoaXMudnBjLmFkZEludGVyZmFjZUVuZHBvaW50KCdCZWRyb2NrUnVudGltZScsIHtcbiAgICAgIHNlcnZpY2U6IG5ldyBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRTZXJ2aWNlKFxuICAgICAgICBgY29tLmFtYXpvbmF3cy4ke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259LmJlZHJvY2stcnVudGltZWAsXG4gICAgICAgIDQ0M1xuICAgICAgKSxcbiAgICAgIHByaXZhdGVEbnNFbmFibGVkOiB0cnVlLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFt2cGNFbmRwb2ludFNlY3VyaXR5R3JvdXBdLFxuICAgICAgc3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBDbG91ZFdhdGNoIE1vbml0b3JpbmcgZW5kcG9pbnRcbiAgICB0aGlzLnZwYy5hZGRJbnRlcmZhY2VFbmRwb2ludCgnQ2xvdWRXYXRjaE1vbml0b3JpbmcnLCB7XG4gICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkNMT1VEV0FUQ0hfTU9OSVRPUklORyxcbiAgICAgIHByaXZhdGVEbnNFbmFibGVkOiB0cnVlLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFt2cGNFbmRwb2ludFNlY3VyaXR5R3JvdXBdLFxuICAgICAgc3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBYLVJheSBlbmRwb2ludCBmb3IgZGlzdHJpYnV0ZWQgdHJhY2luZ1xuICAgIHRoaXMudnBjLmFkZEludGVyZmFjZUVuZHBvaW50KCdYUmF5Jywge1xuICAgICAgc2VydmljZTogZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5YUkFZLFxuICAgICAgcHJpdmF0ZURuc0VuYWJsZWQ6IHRydWUsXG4gICAgICBzZWN1cml0eUdyb3VwczogW3ZwY0VuZHBvaW50U2VjdXJpdHlHcm91cF0sXG4gICAgICBzdWJuZXRzOiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gVGFnIFZQQyBhbmQgc3VibmV0c1xuICAgIGNkay5UYWdzLm9mKHRoaXMudnBjKS5hZGQoJ05hbWUnLCAnSGl2ZW1pbmRQcmlzbS1WUEMnKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLnZwYykuYWRkKCdTZWN1cml0eUxldmVsJywgJ0hpZ2gnKTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVnBjSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMudnBjSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZQQyBJRCBmb3IgSGl2ZW1pbmQtUHJpc20nLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tVnBjSWQnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0NpZHInLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMudnBjQ2lkckJsb2NrLFxuICAgICAgZGVzY3JpcHRpb246ICdWUEMgQ0lEUiBibG9jaycsXG4gICAgfSk7XG4gIH1cbn0iXX0=