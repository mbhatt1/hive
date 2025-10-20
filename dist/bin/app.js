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
// Environment configuration
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
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
    mcpTaskDefinitions: computeStack.mcpTaskDefinitions,
    unpackLambda: computeStack.unpackLambda,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vYmluL2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx1Q0FBcUM7QUFDckMsaURBQW1DO0FBQ25DLDBFQUFzRTtBQUN0RSw0RUFBd0U7QUFDeEUsMEVBQXNFO0FBQ3RFLDBFQUFzRTtBQUN0RSxvRkFBZ0Y7QUFDaEYsc0ZBQWtGO0FBRWxGLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLDRCQUE0QjtBQUM1QixNQUFNLEdBQUcsR0FBRztJQUNWLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYztJQUN0RSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0NBQ3RELENBQUM7QUFFRixvQkFBb0I7QUFDcEIsTUFBTSxXQUFXLEdBQUcsZUFBZSxDQUFDO0FBRXBDLDBDQUEwQztBQUMxQyxNQUFNLFlBQVksR0FBRyxJQUFJLDRCQUFZLENBQUMsR0FBRyxFQUFFLEdBQUcsV0FBVyxVQUFVLEVBQUU7SUFDbkUsR0FBRztJQUNILFdBQVcsRUFBRSx5RUFBeUU7SUFDdEYsSUFBSSxFQUFFO1FBQ0osT0FBTyxFQUFFLGdCQUFnQjtRQUN6QixXQUFXLEVBQUUsWUFBWTtRQUN6QixTQUFTLEVBQUUsS0FBSztLQUNqQjtDQUNGLENBQUMsQ0FBQztBQUVILG1EQUFtRDtBQUNuRCxNQUFNLGFBQWEsR0FBRyxJQUFJLDhCQUFhLENBQUMsR0FBRyxFQUFFLEdBQUcsV0FBVyxXQUFXLEVBQUU7SUFDdEUsR0FBRztJQUNILFdBQVcsRUFBRSx3RUFBd0U7SUFDckYsR0FBRyxFQUFFLFlBQVksQ0FBQyxHQUFHO0lBQ3JCLElBQUksRUFBRTtRQUNKLE9BQU8sRUFBRSxnQkFBZ0I7UUFD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QkFBa0I7SUFDcEQscUJBQXFCLEVBQUUsYUFBYSxDQUFDLHFCQUFxQjtJQUMxRCxJQUFJLEVBQUU7UUFDSixPQUFPLEVBQUUsZ0JBQWdCO1FBQ3pCLFdBQVcsRUFBRSxZQUFZO1FBQ3pCLFNBQVMsRUFBRSxLQUFLO0tBQ2pCO0NBQ0YsQ0FBQyxDQUFDO0FBQ0gsa0JBQWtCLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRS9DLDhEQUE4RDtBQUM5RCw4RUFBOEU7QUFFOUUsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IE5ldHdvcmtTdGFjayB9IGZyb20gJy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9uZXR3b3JrLXN0YWNrJztcbmltcG9ydCB7IFNlY3VyaXR5U3RhY2sgfSBmcm9tICcuLi9pbmZyYXN0cnVjdHVyZS9zdGFja3Mvc2VjdXJpdHktc3RhY2snO1xuaW1wb3J0IHsgU3RvcmFnZVN0YWNrIH0gZnJvbSAnLi4vaW5mcmFzdHJ1Y3R1cmUvc3RhY2tzL3N0b3JhZ2Utc3RhY2snO1xuaW1wb3J0IHsgQ29tcHV0ZVN0YWNrIH0gZnJvbSAnLi4vaW5mcmFzdHJ1Y3R1cmUvc3RhY2tzL2NvbXB1dGUtc3RhY2snO1xuaW1wb3J0IHsgSW50ZWxsaWdlbmNlU3RhY2sgfSBmcm9tICcuLi9pbmZyYXN0cnVjdHVyZS9zdGFja3MvaW50ZWxsaWdlbmNlLXN0YWNrJztcbmltcG9ydCB7IE9yY2hlc3RyYXRpb25TdGFjayB9IGZyb20gJy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9vcmNoZXN0cmF0aW9uLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gRW52aXJvbm1lbnQgY29uZmlndXJhdGlvblxuY29uc3QgZW52ID0ge1xuICBhY2NvdW50OiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5UIHx8IHByb2Nlc3MuZW52LkFXU19BQ0NPVU5UX0lELFxuICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbn07XG5cbi8vIFN0YWNrIG5hbWUgcHJlZml4XG5jb25zdCBzdGFja1ByZWZpeCA9ICdIaXZlbWluZFByaXNtJztcblxuLy8gTmV0d29yayBTdGFjayAtIFZQQywgU3VibmV0cywgRW5kcG9pbnRzXG5jb25zdCBuZXR3b3JrU3RhY2sgPSBuZXcgTmV0d29ya1N0YWNrKGFwcCwgYCR7c3RhY2tQcmVmaXh9LU5ldHdvcmtgLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdIaXZlbWluZC1QcmlzbSBOZXR3b3JrIEluZnJhc3RydWN0dXJlIC0gVlBDLCBTdWJuZXRzLCBhbmQgVlBDIEVuZHBvaW50cycsXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiAnSGl2ZW1pbmQtUHJpc20nLFxuICAgIEVudmlyb25tZW50OiAnUHJvZHVjdGlvbicsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgfSxcbn0pO1xuXG4vLyBTZWN1cml0eSBTdGFjayAtIEtNUywgSUFNIFJvbGVzLCBTZWN1cml0eSBHcm91cHNcbmNvbnN0IHNlY3VyaXR5U3RhY2sgPSBuZXcgU2VjdXJpdHlTdGFjayhhcHAsIGAke3N0YWNrUHJlZml4fS1TZWN1cml0eWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0hpdmVtaW5kLVByaXNtIFNlY3VyaXR5IEluZnJhc3RydWN0dXJlIC0gS01TLCBJQU0sIGFuZCBTZWN1cml0eSBHcm91cHMnLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiAnSGl2ZW1pbmQtUHJpc20nLFxuICAgIEVudmlyb25tZW50OiAnUHJvZHVjdGlvbicsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgfSxcbn0pO1xuc2VjdXJpdHlTdGFjay5hZGREZXBlbmRlbmN5KG5ldHdvcmtTdGFjayk7XG5cbi8vIFN0b3JhZ2UgU3RhY2sgLSBTMyBCdWNrZXRzLCBEeW5hbW9EQiBUYWJsZXMsIEVsYXN0aUNhY2hlXG5jb25zdCBzdG9yYWdlU3RhY2sgPSBuZXcgU3RvcmFnZVN0YWNrKGFwcCwgYCR7c3RhY2tQcmVmaXh9LVN0b3JhZ2VgLCB7XG4gIGVudixcbiAgZGVzY3JpcHRpb246ICdIaXZlbWluZC1QcmlzbSBTdG9yYWdlIEluZnJhc3RydWN0dXJlIC0gUzMsIER5bmFtb0RCLCBhbmQgRWxhc3RpQ2FjaGUnLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIGttc0tleTogc2VjdXJpdHlTdGFjay5rbXNLZXksXG4gIGVsYXN0aUNhY2hlU2VjdXJpdHlHcm91cDogc2VjdXJpdHlTdGFjay5lbGFzdGlDYWNoZVNlY3VyaXR5R3JvdXAsXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiAnSGl2ZW1pbmQtUHJpc20nLFxuICAgIEVudmlyb25tZW50OiAnUHJvZHVjdGlvbicsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgfSxcbn0pO1xuc3RvcmFnZVN0YWNrLmFkZERlcGVuZGVuY3koc2VjdXJpdHlTdGFjayk7XG5cbi8vIEludGVsbGlnZW5jZSBTdGFjayAtIEJlZHJvY2ssIEtlbmRyYVxuY29uc3QgaW50ZWxsaWdlbmNlU3RhY2sgPSBuZXcgSW50ZWxsaWdlbmNlU3RhY2soYXBwLCBgJHtzdGFja1ByZWZpeH0tSW50ZWxsaWdlbmNlYCwge1xuICBlbnYsXG4gIGRlc2NyaXB0aW9uOiAnSGl2ZW1pbmQtUHJpc20gSW50ZWxsaWdlbmNlIEluZnJhc3RydWN0dXJlIC0gQmVkcm9jayBhbmQgS2VuZHJhJyxcbiAga2VuZHJhQnVja2V0OiBzdG9yYWdlU3RhY2sua2VuZHJhQnVja2V0LFxuICBrbXNLZXk6IHNlY3VyaXR5U3RhY2sua21zS2V5LFxuICB0YWdzOiB7XG4gICAgUHJvamVjdDogJ0hpdmVtaW5kLVByaXNtJyxcbiAgICBFbnZpcm9ubWVudDogJ1Byb2R1Y3Rpb24nLFxuICAgIE1hbmFnZWRCeTogJ0NESycsXG4gIH0sXG59KTtcbmludGVsbGlnZW5jZVN0YWNrLmFkZERlcGVuZGVuY3koc3RvcmFnZVN0YWNrKTtcblxuLy8gQ29tcHV0ZSBTdGFjayAtIEVDUyBDbHVzdGVyLCBGYXJnYXRlIFRhc2sgRGVmaW5pdGlvbnMsIExhbWJkYSBGdW5jdGlvbnNcbmNvbnN0IGNvbXB1dGVTdGFjayA9IG5ldyBDb21wdXRlU3RhY2soYXBwLCBgJHtzdGFja1ByZWZpeH0tQ29tcHV0ZWAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0hpdmVtaW5kLVByaXNtIENvbXB1dGUgSW5mcmFzdHJ1Y3R1cmUgLSBFQ1MsIEZhcmdhdGUsIGFuZCBMYW1iZGEnLFxuICB2cGM6IG5ldHdvcmtTdGFjay52cGMsXG4gIGFnZW50U2VjdXJpdHlHcm91cDogc2VjdXJpdHlTdGFjay5hZ2VudFNlY3VyaXR5R3JvdXAsXG4gIG1jcFRvb2xzU2VjdXJpdHlHcm91cDogc2VjdXJpdHlTdGFjay5tY3BUb29sc1NlY3VyaXR5R3JvdXAsXG4gIHVwbG9hZHNCdWNrZXQ6IHN0b3JhZ2VTdGFjay51cGxvYWRzQnVja2V0LFxuICBhcnRpZmFjdHNCdWNrZXQ6IHN0b3JhZ2VTdGFjay5hcnRpZmFjdHNCdWNrZXQsXG4gIGtlbmRyYUJ1Y2tldDogc3RvcmFnZVN0YWNrLmtlbmRyYUJ1Y2tldCxcbiAgbWlzc2lvblN0YXR1c1RhYmxlOiBzdG9yYWdlU3RhY2subWlzc2lvblN0YXR1c1RhYmxlLFxuICB0b29sUmVzdWx0c1RhYmxlOiBzdG9yYWdlU3RhY2sudG9vbFJlc3VsdHNUYWJsZSxcbiAgZmluZGluZ3NUYWJsZTogc3RvcmFnZVN0YWNrLmZpbmRpbmdzQXJjaGl2ZVRhYmxlLFxuICBlbGFzdGlDYWNoZUNsdXN0ZXI6IHN0b3JhZ2VTdGFjay5lbGFzdGlDYWNoZUNsdXN0ZXIsXG4gIGtlbmRyYUluZGV4OiBpbnRlbGxpZ2VuY2VTdGFjay5rZW5kcmFJbmRleCxcbiAga21zS2V5OiBzZWN1cml0eVN0YWNrLmttc0tleSxcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdIaXZlbWluZC1QcmlzbScsXG4gICAgRW52aXJvbm1lbnQ6ICdQcm9kdWN0aW9uJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICB9LFxufSk7XG5jb21wdXRlU3RhY2suYWRkRGVwZW5kZW5jeShpbnRlbGxpZ2VuY2VTdGFjayk7XG5cbi8vIE9yY2hlc3RyYXRpb24gU3RhY2sgLSBTdGVwIEZ1bmN0aW9ucywgRXZlbnRCcmlkZ2VcbmNvbnN0IG9yY2hlc3RyYXRpb25TdGFjayA9IG5ldyBPcmNoZXN0cmF0aW9uU3RhY2soYXBwLCBgJHtzdGFja1ByZWZpeH0tT3JjaGVzdHJhdGlvbmAsIHtcbiAgZW52LFxuICBkZXNjcmlwdGlvbjogJ0hpdmVtaW5kLVByaXNtIE9yY2hlc3RyYXRpb24gSW5mcmFzdHJ1Y3R1cmUgLSBTdGVwIEZ1bmN0aW9ucyBhbmQgRXZlbnRCcmlkZ2UnLFxuICB1cGxvYWRzQnVja2V0OiBzdG9yYWdlU3RhY2sudXBsb2Fkc0J1Y2tldCxcbiAgbWlzc2lvblN0YXR1c1RhYmxlOiBzdG9yYWdlU3RhY2subWlzc2lvblN0YXR1c1RhYmxlLFxuICBhZ2VudFRhc2tEZWZpbml0aW9uczogY29tcHV0ZVN0YWNrLmFnZW50VGFza0RlZmluaXRpb25zLFxuICBtY3BUYXNrRGVmaW5pdGlvbnM6IGNvbXB1dGVTdGFjay5tY3BUYXNrRGVmaW5pdGlvbnMsXG4gIHVucGFja0xhbWJkYTogY29tcHV0ZVN0YWNrLnVucGFja0xhbWJkYSxcbiAgZWNzQ2x1c3RlcjogY29tcHV0ZVN0YWNrLmVjc0NsdXN0ZXIsXG4gIHZwYzogbmV0d29ya1N0YWNrLnZwYyxcbiAgYWdlbnRTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLmFnZW50U2VjdXJpdHlHcm91cCxcbiAgbWNwVG9vbHNTZWN1cml0eUdyb3VwOiBzZWN1cml0eVN0YWNrLm1jcFRvb2xzU2VjdXJpdHlHcm91cCxcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdIaXZlbWluZC1QcmlzbScsXG4gICAgRW52aXJvbm1lbnQ6ICdQcm9kdWN0aW9uJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICB9LFxufSk7XG5vcmNoZXN0cmF0aW9uU3RhY2suYWRkRGVwZW5kZW5jeShjb21wdXRlU3RhY2spO1xuXG4vLyBPdXRwdXRzIGFyZSBub3cgZGVmaW5lZCB3aXRoaW4gdGhlaXIgcmVzcGVjdGl2ZSBzdGFjayBmaWxlc1xuLy8gVGhpcyBhdm9pZHMgdGhlIFwiQ2ZuT3V0cHV0IHNob3VsZCBiZSBjcmVhdGVkIGluIHRoZSBzY29wZSBvZiBhIFN0YWNrXCIgZXJyb3JcblxuYXBwLnN5bnRoKCk7Il19