#!/usr/bin/env node
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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const network_stack_1 = require("../infrastructure/stacks/network-stack");
const security_stack_1 = require("../infrastructure/stacks/security-stack");
const storage_stack_1 = require("../infrastructure/stacks/storage-stack");
const compute_stack_1 = require("../infrastructure/stacks/compute-stack");
const intelligence_stack_1 = require("../infrastructure/stacks/intelligence-stack");
const orchestration_stack_1 = require("../infrastructure/stacks/orchestration-stack");
const app = new cdk.App();
// Environment configuration with validation
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';
if (!account) {
    throw new Error('AWS account ID must be provided via CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable');
}
const env = {
    account,
    region,
};
// Stack name prefix
const stackPrefix = 'HivemindPrism';
// Network Stack - VPC, Subnets, Endpoints
const networkStack = new network_stack_1.NetworkStack(app, `${stackPrefix}-Network`, {
    env,
    description: 'Hivemind-Prism Network Infrastructure - VPC, Subnets, and VPC Endpoints',
    tags: {
        Project: 'Hivemind-Prism',
        Environment: 'Production',
        ManagedBy: 'CDK',
    },
});
// Security Stack - KMS, IAM Roles, Security Groups
const securityStack = new security_stack_1.SecurityStack(app, `${stackPrefix}-Security`, {
    env,
    description: 'Hivemind-Prism Security Infrastructure - KMS, IAM, and Security Groups',
    vpc: networkStack.vpc,
    tags: {
        Project: 'Hivemind-Prism',
        Environment: 'Production',
        ManagedBy: 'CDK',
    },
});
securityStack.addDependency(networkStack);
// Storage Stack - S3 Buckets, DynamoDB Tables, ElastiCache
const storageStack = new storage_stack_1.StorageStack(app, `${stackPrefix}-Storage`, {
    env,
    description: 'Hivemind-Prism Storage Infrastructure - S3, DynamoDB, and ElastiCache',
    vpc: networkStack.vpc,
    kmsKey: securityStack.kmsKey,
    elastiCacheSecurityGroup: securityStack.elastiCacheSecurityGroup,
    tags: {
        Project: 'Hivemind-Prism',
        Environment: 'Production',
        ManagedBy: 'CDK',
    },
});
storageStack.addDependency(securityStack);
// Intelligence Stack - Bedrock, Kendra
const intelligenceStack = new intelligence_stack_1.IntelligenceStack(app, `${stackPrefix}-Intelligence`, {
    env,
    description: 'Hivemind-Prism Intelligence Infrastructure - Bedrock and Kendra',
    kendraBucket: storageStack.kendraBucket,
    kmsKey: securityStack.kmsKey,
    tags: {
        Project: 'Hivemind-Prism',
        Environment: 'Production',
        ManagedBy: 'CDK',
    },
});
intelligenceStack.addDependency(storageStack);
// Compute Stack - ECS Cluster, Fargate Task Definitions, Lambda Functions
const computeStack = new compute_stack_1.ComputeStack(app, `${stackPrefix}-Compute`, {
    env,
    description: 'Hivemind-Prism Compute Infrastructure - ECS, Fargate, and Lambda',
    vpc: networkStack.vpc,
    agentSecurityGroup: securityStack.agentSecurityGroup,
    mcpToolsSecurityGroup: securityStack.mcpToolsSecurityGroup,
    uploadsBucket: storageStack.uploadsBucket,
    artifactsBucket: storageStack.artifactsBucket,
    kendraBucket: storageStack.kendraBucket,
    missionStatusTable: storageStack.missionStatusTable,
    toolResultsTable: storageStack.toolResultsTable,
    findingsTable: storageStack.findingsArchiveTable,
    elastiCacheCluster: storageStack.elastiCacheCluster,
    kendraIndex: intelligenceStack.kendraIndex,
    kmsKey: securityStack.kmsKey,
    tags: {
        Project: 'Hivemind-Prism',
        Environment: 'Production',
        ManagedBy: 'CDK',
    },
});
computeStack.addDependency(intelligenceStack);
// Orchestration Stack - Step Functions, EventBridge
const orchestrationStack = new orchestration_stack_1.OrchestrationStack(app, `${stackPrefix}-Orchestration`, {
    env,
    description: 'Hivemind-Prism Orchestration Infrastructure - Step Functions and EventBridge',
    uploadsBucket: storageStack.uploadsBucket,
    missionStatusTable: storageStack.missionStatusTable,
    agentTaskDefinitions: computeStack.agentTaskDefinitions,
    unpackLambda: computeStack.unpackLambda,
    failureHandlerLambda: computeStack.failureHandlerLambda,
    ecsCluster: computeStack.ecsCluster,
    vpc: networkStack.vpc,
    agentSecurityGroup: securityStack.agentSecurityGroup,
    mcpToolsSecurityGroup: securityStack.mcpToolsSecurityGroup,
    tags: {
        Project: 'Hivemind-Prism',
        Environment: 'Production',
        ManagedBy: 'CDK',
    },
});
orchestrationStack.addDependency(computeStack);
// Outputs are now defined within their respective stack files
// This avoids the "CfnOutput should be created in the scope of a Stack" error
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vYmluL2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx1Q0FBcUM7QUFDckMsaURBQW1DO0FBQ25DLDBFQUFzRTtBQUN0RSw0RUFBd0U7QUFDeEUsMEVBQXNFO0FBQ3RFLDBFQUFzRTtBQUN0RSxvRkFBZ0Y7QUFDaEYsc0ZBQWtGO0FBRWxGLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLDRDQUE0QztBQUM1QyxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDO0FBQzlFLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVyxDQUFDO0FBRTdELElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUNiLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0dBQWdHLENBQUMsQ0FBQztBQUNwSCxDQUFDO0FBRUQsTUFBTSxHQUFHLEdBQUc7SUFDVixPQUFPO0lBQ1AsTUFBTTtDQUNQLENBQUM7QUFFRixvQkFBb0I7QUFDcEIsTUFBTSxXQUFXLEdBQUcsZUFBZSxDQUFDO0FBRXBDLDBDQUEwQztBQUMxQyxNQUFNLFlBQVksR0FBRyxJQUFJLDRCQUFZLENBQUMsR0FBRyxFQUFFLEdBQUcsV0FBVyxVQUFVLEVBQUU7SUFDbkUsR0FBRztJQUNILFdBQVcsRUFBRSx5RUFBeUU7SUFDdEYsSUFBSSxFQUFFO1FBQ0osT0FBTyxFQUFFLGdCQUFnQjtRQUN6QixXQUFXLEVBQUUsWUFBWTtRQUN6QixTQUFTLEVBQUUsS0FBSztLQUNqQjtDQUNGLENBQUMsQ0FBQztBQUVILG1EQUFtRDtBQUNuRCxNQUFNLGFBQWEsR0FBRyxJQUFJLDhCQUFhLENBQUMsR0FBRyxFQUFFLEdB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dkMsb0JBQW9CLEVBQUUsWUFBWSxDQUFDLG9CQUFvQjtJQUN2RCxVQUFVLEVBQUUsWUFBWSxDQUFDLFVBQVU7SUFDbkMsR0FBRyxFQUFFLFlBQVksQ0FBQyxHQUFHO0lBQ3JCLGtCQUFrQixFQUFFLGFBQWEsQ0FBQyxrQkFBa0I7SUFDcEQscUJBQXFCLEVBQUUsYUFBYSxDQUFDLHFCQUFxQjtJQUMxRCxJQUFJLEVBQUU7UUFDSixPQUFPLEVBQUUsZ0JBQWdCO1FBQ3pCLFdBQVcsRUFBRSxZQUFZO1FBQ3pCLFNBQVMsRUFBRSxLQUFLO0tBQ2pCO0NBQ0YsQ0FBQyxDQUFDO0FBQ0gsa0JBQWtCLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRS9DLDhEQUE4RDtBQUM5RCw4RUFBOEU7QUFFOUUsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE5ldHdvcmtTdGFjayB9IGZyb20gJy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9uZXR3b3JrLXN0YWNrJztcbmltcG9ydCB7IFNlY3VyaXR5U3RhY2sgfSBmcm9tICcuLi9pbmZyYXN0cnVjdHVyZS9zdGFja3Mvc2VjdXJpdHktc3RhY2snO1xuaW1wb3J0IHsgU3RvcmFnZVN0YWNrIH0gZnJvbSAnLi4vaW5mcmFzdHJ1Y3R1cmUvc3RhY2tzL3N0b3JhZ2Utc3RhY2snO1xuaW1wb3J0IHsgQ29tcHV0ZVN0YWNrIH0gZnJvbSAnLi4vaW5mcmFzdHJ1Y3R1cmUvc3RhY2tzL2NvbXB1dGUtc3RhY2snO1xuaW1wb3J0IHsgSW50ZWxsaWdlbmNlU3RhY2sgfSBmcm9tICcuLi9pbmZyYXN0cnVjdHVyZS9zdGFja3MvaW50ZWxsaWdlbmNlLXN0YWNrJztcbmltcG9ydCB7IE9yY2hlc3RyYXRpb25TdGFjayB9IGZyb20gJy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9vcmNoZXN0cmF0aW9uLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gRW52aXJvbm1lbnQgY29uZmlndXJhdGlvbiB3aXRoIHZhbGlkYXRpb25cbmNvbnN0IGFjY291bnQgPSBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5UIHx8IHByb2Nlc3MuZW52LkFXU19BQ0NPVU5UX0lEO1xuY29uc3QgcmVnaW9uID0gcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICd1cy1lYXN0LTEnO1xuXG5pZiAoIWFjY291bnQpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdBV1MgYWNjb3VudCBJRCBtdXN0IGJlIHByb3ZpZGVkIHZpYSBDREtfREVGQVVMVF9BQ0NPVU5UIG9yIEFXU19BQ0NPVU5UX0lEIGVudmlyb25tZW50IHZhcmlhYmxlJyk7XG59XG5cbmNvbnN0IGVudiA9IHtcbiAgYWNjb3VudCxcbiAgcmVnaW9uLFxufTtcblxuLy8gU3RhY2sgbmFtZSBwcmVmaXhcbmNvbnN0IHN0YWNrUHJlZml4ID0gJ0hpdmVtaW5kUHJpc20nO1xuXG4vLyBOZXR3b3JrIFN0YWNrIC0gVlBDLCBTdWJuZXRzLCBFbmRwb2ludHNcbmNvbnN0IG5ldHdvcmtTdGFjayA9IG5ldyBOZXR3b3JrU3RhY2soYXBwLCBgJHtzdGFja1ByZWZpeH0tTmV0d29ya2AsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0hpdmVtaW5kLVByaXNtIE5ldHdvcmsgSW5mcmFzdHJ1Y3R1cmUgLSBWUEMsIFN1Ym5ldHMsIGFuZCBWUEMgRW5kcG9pbnRzJyxcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdIaXZlbWluZC1QcmlzbScsXG4gICAgRW52aXJvbm1lbnQ6ICdQcm9kdWN0aW9uJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICB9LFxufSk7XG5cbi8vIFNlY3VyaXR5IFN0YWNrIC0gS01TLCBJQU0gUm9sZXMsIFNlY3VyaXR5IEdyb3Vwc1xuY29uc3Qgc2VjdXJpdHlTdGFjayA9IG5ldyBTZWN1cml0eVN0YWNrKGFwcCwgYCR7c3RhY2tQcmVmaXh9LVNlY3VyaXR5YCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnSGl2ZW1pbmQtUHJpc20gU2VjdXJpdHkgSW5mcmFzdHJ1Y3R1cmUgLSBLTVMsIElBTSwgYW5kIFNlY3VyaXR5IEdyb3VwcycsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdIaXZlbWluZC1QcmlzbScsXG4gICAgRW52aXJvbm1lbnQ6ICdQcm9kdWN0aW9uJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICB9LFxufSk7XG5zZWN1cml0eVN0YWNrLmFkZERlcGVuZGVuY3kobmV0d29ya1N0YWNrKTtcblxuLy8gU3RvcmFnZSBTdGFjayAtIFMzIEJ1Y2tldHMsIER5bmFtb0RCIFRhYmxlcywgRWxhc3RpQ2FjaGVcbmNvbnN0IHN0b3JhZ2VTdGFjayA9IG5ldyBTdG9yYWdlU3RhY2soYXBwLCBgJHtzdGFja1ByZWZpeH0tU3RvcmFnZWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0hpdmVtaW5kLVByaXNtIFN0b3JhZ2UgSW5mcmFzdHJ1Y3R1cmUgLSBTMywgRHluYW1vREIsIGFuZCBFbGFzdGlDYWNoZScsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAga21zS2V5OiBzZWN1cml0eVN0YWNrLmttc0tleSxcbiAgZWxhc3RpQ2FjaGVTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLmVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cCxcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdIaXZlbWluZC1QcmlzbScsXG4gICAgRW52aXJvbm1lbnQ6ICdQcm9kdWN0aW9uJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICB9LFxufSk7XG5zdG9yYWdlU3RhY2suYWRkRGVwZW5kZW5jeShzZWN1cml0eVN0YWNrKTtcblxuLy8gSW50ZWxsaWdlbmNlIFN0YWNrIC0gQmVkcm9jaywgS2VuZHJhXG5jb25zdCBpbnRlbGxpZ2VuY2VTdGFjayA9IG5ldyBJbnRlbGxpZ2VuY2VTdGFjayhhcHAsIGAke3N0YWNrUHJlZml4fS1JbnRlbGxpZ2VuY2VgLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdIaXZlbWluZC1QcmlzbSBJbnRlbGxpZ2VuY2UgSW5mcmFzdHJ1Y3R1cmUgLSBCZWRyb2NrIGFuZCBLZW5kcmEnLFxuICBrZW5kcmFCdWNrZXQ6IHN0b3JhZ2VTdGFjay5rZW5kcmFCdWNrZXQsXG4gIGttc0tleTogc2VjdXJpdHlTdGFjay5rbXNLZXksXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiAnSGl2ZW1pbmQtUHJpc20nLFxuICAgIEVudmlyb25tZW50OiAnUHJvZHVjdGlvbicsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgfSxcbn0pO1xuaW50ZWxsaWdlbmNlU3RhY2suYWRkRGVwZW5kZW5jeShzdG9yYWdlU3RhY2spO1xuXG4vLyBDb21wdXRlIFN0YWNrIC0gRUNTIENsdXN0ZXIsIEZhcmdhdGUgVGFzayBEZWZpbml0aW9ucywgTGFtYmRhIEZ1bmN0aW9uc1xuY29uc3QgY29tcHV0ZVN0YWNrID0gbmV3IENvbXB1dGVTdGFjayhhcHAsIGAke3N0YWNrUHJlZml4fS1Db21wdXRlYCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnSGl2ZW1pbmQtUHJpc20gQ29tcHV0ZSBJbmZyYXN0cnVjdHVyZSAtIEVDUywgRmFyZ2F0ZSwgYW5kIExhbWJkYScsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgYWdlbnRTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLmFnZW50U2VjdXJpdHlHcm91cCxcbiAgbWNwVG9vbHNTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLm1jcFRvb2xzU2VjdXJpdHlHcm91cCxcbiAgdXBsb2Fkc0J1Y2tldDogc3RvcmFnZVN0YWNrLnVwbG9hZHNCdWNrZXQsXG4gIGFydGlmYWN0c0J1Y2tldDogc3RvcmFnZVN0YWNrLmFydGlmYWN0c0J1Y2tldCxcbiAga2VuZHJhQnVja2V0OiBzdG9yYWdlU3RhY2sua2VuZHJhQnVja2V0LFxuICBtaXNzaW9uU3RhdHVzVGFibGU6IHN0b3JhZ2VTdGFjay5taXNzaW9uU3RhdHVzVGFibGUsXG4gIHRvb2xSZXN1bHRzVGFibGU6IHN0b3JhZ2VTdGFjay50b29sUmVzdWx0c1RhYmxlLFxuICBmaW5kaW5nc1RhYmxlOiBzdG9yYWdlU3RhY2suZmluZGluZ3NBcmNoaXZlVGFibGUsXG4gIGVsYXN0aUNhY2hlQ2x1c3Rlcjogc3RvcmFnZVN0YWNrLmVsYXN0aUNhY2hlQ2x1c3RlcixcbiAga2VuZHJhSW5kZXg6IGludGVsbGlnZW5jZVN0YWNrLmtlbmRyYUluZGV4LFxuICBrbXNLZXk6IHNlY3VyaXR5U3RhY2sua21zS2V5LFxuICB0YWdzOiB7XG4gICAgUHJvamVjdDogJ0hpdmVtaW5kLVByaXNtJyxcbiAgICBFbnZpcm9ubWVudDogJ1Byb2R1Y3Rpb24nLFxuICAgIE1hbmFnZWRCeTogJ0NESycsXG4gIH0sXG59KTtcbmNvbXB1dGVTdGFjay5hZGREZXBlbmRlbmN5KGludGVsbGlnZW5jZVN0YWNrKTtcblxuLy8gT3JjaGVzdHJhdGlvbiBTdGFjayAtIFN0ZXAgRnVuY3Rpb25zLCBFdmVudEJyaWRnZVxuY29uc3Qgb3JjaGVzdHJhdGlvblN0YWNrID0gbmV3IE9yY2hlc3RyYXRpb25TdGFjayhhcHAsIGAke3N0YWNrUHJlZml4fS1PcmNoZXN0cmF0aW9uYCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnSGl2ZW1pbmQtUHJpc20gT3JjaGVzdHJhdGlvbiBJbmZyYXN0cnVjdHVyZSAtIFN0ZXAgRnVuY3Rpb25zIGFuZCBFdmVudEJyaWRnZScsXG4gIHVwbG9hZHNCdWNrZXQ6IHN0b3JhZ2VTdGFjay51cGxvYWRzQnVja2V0LFxuICBtaXNzaW9uU3RhdHVzVGFibGU6IHN0b3JhZ2VTdGFjay5taXNzaW9uU3RhdHVzVGFibGUsXG4gIGFnZW50VGFza0RlZmluaXRpb25zOiBjb21wdXRlU3RhY2suYWdlbnRUYXNrRGVmaW5pdGlvbnMsXG4gIHVucGFja0xhbWJkYTogY29tcHV0ZVN0YWNrLnVucGFja0xhbWJkYSxcbiAgZmFpbHVyZUhhbmRsZXJMYW1iZGE6IGNvbXB1dGVTdGFjay5mYWlsdXJlSGFuZGxlckxhbWJkYSxcbiAgZWNzQ2x1c3RlcjogY29tcHV0ZVN0YWNrLmVjc0NsdXN0ZXIsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgYWdlbnRTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLmFnZW50U2VjdXJpdHlHcm91cCxcbiAgbWNwVG9vbHNTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLm1jcFRvb2xzU2VjdXJpdHlHcm91cCxcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdIaXZlbWluZC1QcmlzbScsXG4gICAgRW52aXJvbm1lbnQ6ICdQcm9kdWN0aW9uJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICB9LFxufSk7XG5vcmNoZXN0cmF0aW9uU3RhY2suYWRkRGVwZW5kZW5jeShjb21wdXRlU3RhY2spO1xuXG4vLyBPdXRwdXRzIGFyZSBub3cgZGVmaW5lZCB3aXRoaW4gdGhlaXIgcmVzcGVjdGl2ZSBzdGFjayBmaWxlc1xuLy8gVGhpcyBhdm9pZHMgdGhlIFwiQ2ZuT3V0cHV0IHNob3VsZCBiZSBjcmVhdGVkIGluIHRoZSBzY29wZSBvZiBhIFN0YWNrXCIgZXJyb3JcblxuYXBwLnN5bnRoKCk7Il19