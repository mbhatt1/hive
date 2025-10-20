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
        // Create VPC with public, private, and isolated subnets
        this.vpc = new ec2.Vpc(this, 'HivemindVpc', {
            ipAddresses: ec2.IpAddresses.cidr('10.10.0.0/16'),
            maxAzs: 2,
            natGateways: 1, // Cost optimization: single NAT gateway
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
        this.privateSubnets = this.vpc.privateSubnets;
        this.isolatedSubnets = this.vpc.isolatedSubnets;
        // Add VPC Gateway Endpoints for S3 and DynamoDB (no cost, better performance)
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
        // Add VPC Interface Endpoints for AWS services
        // Security groups will be added by the Security Stack
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
                subnets: {
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
            });
        });
        // Add Bedrock endpoint (custom service endpoint)
        this.vpc.addInterfaceEndpoint('BedrockRuntime', {
            service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${cdk.Stack.of(this).region}.bedrock-runtime`, 443),
            privateDnsEnabled: true,
            subnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
        });
        // Add CloudWatch Monitoring endpoint
        this.vpc.addInterfaceEndpoint('CloudWatchMonitoring', {
            service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
            privateDnsEnabled: true,
            subnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
        });
        // Add X-Ray endpoint for distributed tracing
        this.vpc.addInterfaceEndpoint('XRay', {
            service: ec2.InterfaceVpcEndpointAwsService.XRAY,
            privateDnsEnabled: true,
            subnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmV0d29yay1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9uZXR3b3JrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFHM0MsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFLekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix3REFBd0Q7UUFDeEQsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUMxQyxXQUFXLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDO1lBQ2pELE1BQU0sRUFBRSxDQUFDO1lBQ1QsV0FBVyxFQUFFLENBQUMsRUFBRSx3Q0FBd0M7WUFDeEQsbUJBQW1CLEVBQUU7Z0JBQ25CO29CQUNFLElBQUksRUFBRSxRQUFRO29CQUNkLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE1BQU07b0JBQ2pDLFFBQVEsRUFBRSxFQUFFO2lCQUNiO2dCQUNEO29CQUNFLElBQUksRUFBRSxTQUFTO29CQUNmLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLG1CQUFtQjtvQkFDOUMsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLFVBQVU7b0JBQ2hCLFVBQVUsRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQjtvQkFDM0MsUUFBUSxFQUFFLEVBQUU7aUJBQ2I7YUFDRjtZQUNELGtCQUFrQixFQUFFLElBQUk7WUFDeEIsZ0JBQWdCLEVBQUUsSUFBSTtTQUN2QixDQUFDLENBQUM7UUFF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QyxJQUFJLEVBQUUsU0FBUyxFQUFFO1lBQ2pDLEtBQUssRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLFlBQVk7WUFDNUIsV0FBVyxFQUFFLGdCQUFnQjtTQUM5QixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF2SkQsb0NBdUpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgY2xhc3MgTmV0d29ya1N0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHZwYzogZWMyLlZwYztcbiAgcHVibGljIHJlYWRvbmx5IHByaXZhdGVTdWJuZXRzOiBlYzIuSVN1Ym5ldFtdO1xuICBwdWJsaWMgcmVhZG9ubHkgaXNvbGF0ZWRTdWJuZXRzOiBlYzIuSVN1Ym5ldFtdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENyZWF0ZSBWUEMgd2l0aCBwdWJsaWMsIHByaXZhdGUsIGFuZCBpc29sYXRlZCBzdWJuZXRzXG4gICAgdGhpcy52cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnSGl2ZW1pbmRWcGMnLCB7XG4gICAgICBpcEFkZHJlc3NlczogZWMyLklwQWRkcmVzc2VzLmNpZHIoJzEwLjEwLjAuMC8xNicpLFxuICAgICAgbWF4QXpzOiAyLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsIC8vIENvc3Qgb3B0aW1pemF0aW9uOiBzaW5nbGUgTkFUIGdhdGV3YXlcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdQdWJsaWMnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnUHJpdmF0ZScsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnSXNvbGF0ZWQnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQsXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGVuYWJsZURuc0hvc3RuYW1lczogdHJ1ZSxcbiAgICAgIGVuYWJsZURuc1N1cHBvcnQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICB0aGlzLnByaXZhdGVTdWJuZXRzID0gdGhpcy52cGMucHJpdmF0ZVN1Ym5ldHM7XG4gICAgdGhpcy5pc29sYXRlZFN1Ym5ldHMgPSB0aGlzLnZwYy5pc29sYXRlZFN1Ym5ldHM7XG5cbiAgICAvLyBBZGQgVlBDIEdhdGV3YXkgRW5kcG9pbnRzIGZvciBTMyBhbmQgRHluYW1vREIgKG5vIGNvc3QsIGJldHRlciBwZXJmb3JtYW5jZSlcbiAgICB0aGlzLnZwYy5hZGRHYXRld2F5RW5kcG9pbnQoJ1MzRW5kcG9pbnQnLCB7XG4gICAgICBzZXJ2aWNlOiBlYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5TMyxcbiAgICAgIHN1Ym5ldHM6IFtcbiAgICAgICAgeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTIH0sXG4gICAgICAgIHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIHRoaXMudnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnRHluYW1vRGJFbmRwb2ludCcsIHtcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCLFxuICAgICAgc3VibmV0czogW1xuICAgICAgICB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgICAgeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIFZQQyBJbnRlcmZhY2UgRW5kcG9pbnRzIGZvciBBV1Mgc2VydmljZXNcbiAgICAvLyBTZWN1cml0eSBncm91cHMgd2lsbCBiZSBhZGRlZCBieSB0aGUgU2VjdXJpdHkgU3RhY2tcbiAgICBjb25zdCBpbnRlcmZhY2VFbmRwb2ludHMgPSBbXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdFY3JBcGknLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkVDUixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdFY3JEb2NrZXInLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkVDUl9ET0NLRVIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBuYW1lOiAnQ2xvdWRXYXRjaExvZ3MnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkNMT1VEV0FUQ0hfTE9HUyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdTZWNyZXRzTWFuYWdlcicsXG4gICAgICAgIHNlcnZpY2U6IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludEF3c1NlcnZpY2UuU0VDUkVUU19NQU5BR0VSLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ1N0cycsXG4gICAgICAgIHNlcnZpY2U6IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludEF3c1NlcnZpY2UuU1RTLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ1N0ZXBGdW5jdGlvbnMnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlNURVBfRlVOQ1RJT05TLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ0V2ZW50QnJpZGdlJyxcbiAgICAgICAgc2VydmljZTogZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5FVkVOVEJSSURHRSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdTbnMnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlNOUyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdLbXMnLFxuICAgICAgICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLktNUyxcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIGludGVyZmFjZUVuZHBvaW50cy5mb3JFYWNoKChlbmRwb2ludCkgPT4ge1xuICAgICAgdGhpcy52cGMuYWRkSW50ZXJmYWNlRW5kcG9pbnQoZW5kcG9pbnQubmFtZSwge1xuICAgICAgICBzZXJ2aWNlOiBlbmRwb2ludC5zZXJ2aWNlLFxuICAgICAgICBwcml2YXRlRG5zRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc3VibmV0czoge1xuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBCZWRyb2NrIGVuZHBvaW50IChjdXN0b20gc2VydmljZSBlbmRwb2ludClcbiAgICB0aGlzLnZwYy5hZGRJbnRlcmZhY2VFbmRwb2ludCgnQmVkcm9ja1J1bnRpbWUnLCB7XG4gICAgICBzZXJ2aWNlOiBuZXcgZWMyLkludGVyZmFjZVZwY0VuZHBvaW50U2VydmljZShcbiAgICAgICAgYGNvbS5hbWF6b25hd3MuJHtjZGsuU3RhY2sub2YodGhpcykucmVnaW9ufS5iZWRyb2NrLXJ1bnRpbWVgLFxuICAgICAgICA0NDNcbiAgICAgICksXG4gICAgICBwcml2YXRlRG5zRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHN1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgQ2xvdWRXYXRjaCBNb25pdG9yaW5nIGVuZHBvaW50XG4gICAgdGhpcy52cGMuYWRkSW50ZXJmYWNlRW5kcG9pbnQoJ0Nsb3VkV2F0Y2hNb25pdG9yaW5nJywge1xuICAgICAgc2VydmljZTogZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5DTE9VRFdBVENIX01PTklUT1JJTkcsXG4gICAgICBwcml2YXRlRG5zRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHN1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgWC1SYXkgZW5kcG9pbnQgZm9yIGRpc3RyaWJ1dGVkIHRyYWNpbmdcbiAgICB0aGlzLnZwYy5hZGRJbnRlcmZhY2VFbmRwb2ludCgnWFJheScsIHtcbiAgICAgIHNlcnZpY2U6IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludEF3c1NlcnZpY2UuWFJBWSxcbiAgICAgIHByaXZhdGVEbnNFbmFibGVkOiB0cnVlLFxuICAgICAgc3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFRhZyBWUEMgYW5kIHN1Ym5ldHNcbiAgICBjZGsuVGFncy5vZih0aGlzLnZwYykuYWRkKCdOYW1lJywgJ0hpdmVtaW5kUHJpc20tVlBDJyk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy52cGMpLmFkZCgnU2VjdXJpdHlMZXZlbCcsICdIaWdoJyk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZwY0lkJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLnZwY0lkLFxuICAgICAgZGVzY3JpcHRpb246ICdWUEMgSUQgZm9yIEhpdmVtaW5kLVByaXNtJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLVZwY0lkJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdWcGNDaWRyJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLnZwY0NpZHJCbG9jayxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVlBDIENJRFIgYmxvY2snLFxuICAgIH0pO1xuICB9XG59Il19