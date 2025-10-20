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
exports.OrchestrationStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const sfn = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const tasks = __importStar(require("aws-cdk-lib/aws-stepfunctions-tasks"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
class OrchestrationStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ========== STEP FUNCTIONS ROLE ==========
        // Create Step Functions role here to avoid circular dependency
        // (Security → Compute → Intelligence → Storage → Security cycle)
        const stepFunctionsRole = new iam.Role(this, 'StepFunctionsOrchestratorRole', {
            assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
            roleName: 'HivemindStepFunctionsRole',
            description: 'Role for Step Functions state machine orchestration',
        });
        // ========== SNS TOPIC FOR NOTIFICATIONS ==========
        this.completionTopic = new sns.Topic(this, 'CompletionTopic', {
            topicName: 'HivemindMissionCompletions',
            displayName: 'Hivemind Mission Completion Notifications',
        });
        // ========== STEP FUNCTIONS STATE MACHINE ==========
        // 1. Unpack and Validate
        const unpackTask = new tasks.LambdaInvoke(this, 'UnpackAndValidate', {
            lambdaFunction: props.unpackLambda,
            outputPath: '$.Payload',
            retryOnServiceExceptions: true,
        });
        // 2. Coordinator Decision
        const coordinatorTask = this.createAgentTask('CoordinatorDecision', props.agentTaskDefinitions.coordinator, props);
        // 3a. AWS Scan Path - Just Strategist (skip Archaeologist)
        const strategistTaskAWS = this.createAgentTask('StrategistTaskAWS', props.agentTaskDefinitions.strategist, props);
        strategistTaskAWS.next(coordinatorTask);
        // 3b. Code Scan Path - Deploy Context Agents (Parallel)
        const archaeologistTask = this.createAgentTask('ArchaeologistTask', props.agentTaskDefinitions.archaeologist, props);
        const strategistTask = this.createAgentTask('StrategistTask', props.agentTaskDefinitions.strategist, props);
        const contextAgentsParallel = new sfn.Parallel(this, 'DeployContextAgents', {
            resultPath: '$.context_results',
        });
        contextAgentsParallel.branch(archaeologistTask);
        contextAgentsParallel.branch(strategistTask);
        contextAgentsParallel.next(coordinatorTask);
        // 3c. Scan Type Decision - Branch to appropriate path
        const scanTypeChoice = new sfn.Choice(this, 'ScanTypeDecision')
            .when(sfn.Condition.stringEquals('$.scan_type', 'aws'), strategistTaskAWS)
            .otherwise(contextAgentsParallel);
        // 4. Dynamic MCP Invocation (Map State)
        const mcpInvocationMap = new sfn.Map(this, 'DynamicMCPInvocation', {
            maxConcurrency: 5,
            itemsPath: '$.execution_plan.tools',
            resultPath: '$.mcp_results',
        });
        // Create MCP task (will be dynamically selected)
        const mcpTask = new tasks.EcsRunTask(this, 'InvokeMCPTool', {
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            cluster: props.ecsCluster,
            taskDefinition: props.mcpTaskDefinitions['semgrep-mcp'], // Default, will be overridden
            launchTarget: new tasks.EcsFargateLaunchTarget({
                platformVersion: ecs.FargatePlatformVersion.LATEST,
            }),
            containerOverrides: [
                {
                    containerDefinition: props.mcpTaskDefinitions['semgrep-mcp'].defaultContainer,
                    environment: [
                        {
                            name: 'MISSION_ID',
                            value: sfn.JsonPath.stringAt('$.mission_id'),
                        },
                    ],
                },
            ],
            securityGroups: [props.mcpToolsSecurityGroup],
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        });
        mcpInvocationMap.iterator(mcpTask);
        // 5. Wait for S3 Consistency
        const waitForTools = new sfn.Wait(this, 'WaitForAllTools', {
            time: sfn.WaitTime.duration(cdk.Duration.seconds(5)),
        });
        // 6. Synthesis Crucible (Parallel)
        const synthesizerTask = this.createAgentTask('SynthesizerTask', props.agentTaskDefinitions.synthesizer, props);
        const criticTask = this.createAgentTask('CriticTask', props.agentTaskDefinitions.critic, props);
        const synthesisCrucible = new sfn.Parallel(this, 'LaunchSynthesisCrucible', {
            resultPath: '$.synthesis_results',
        });
        synthesisCrucible.branch(synthesizerTask);
        synthesisCrucible.branch(criticTask);
        // 7. Wait for Negotiation
        const waitForConsensus = new sfn.Wait(this, 'WaitForConsensus', {
            time: sfn.WaitTime.duration(cdk.Duration.seconds(10)),
        });
        // 8. Archivist Task
        const archivistTask = this.createAgentTask('ArchivistTask', props.agentTaskDefinitions.archivist, props);
        // 9. Notify Completion
        const notifyCompletion = new tasks.SnsPublish(this, 'NotifyCompletion', {
            topic: this.completionTopic,
            message: sfn.TaskInput.fromObject({
                mission_id: sfn.JsonPath.stringAt('$.mission_id'),
                status: 'COMPLETED',
                findings_count: sfn.JsonPath.stringAt('$.archival_result.count'),
            }),
        });
        // 10. Failure Handler
        const handleFailure = new tasks.LambdaInvoke(this, 'HandleFailure', {
            lambdaFunction: props.unpackLambda, // Reuse for simplicity, should be separate
            payload: sfn.TaskInput.fromObject({
                mission_id: sfn.JsonPath.stringAt('$.mission_id'),
                error: sfn.JsonPath.stringAt('$.error'),
            }),
        });
        const failureEnd = new sfn.Succeed(this, 'FailureRecorded');
        // Chain the states: unpack -> scan type choice -> (aws/code paths) -> coordinator -> rest
        const definition = unpackTask
            .next(scanTypeChoice);
        // After coordinator, continue with common path
        coordinatorTask
            .next(mcpInvocationMap)
            .next(waitForTools)
            .next(synthesisCrucible)
            .next(waitForConsensus)
            .next(archivistTask)
            .next(notifyCompletion);
        // Add error handling
        unpackTask.addCatch(handleFailure.next(failureEnd), {
            errors: ['States.ALL'],
            resultPath: '$.error',
        });
        // Create State Machine
        this.stateMachine = new sfn.StateMachine(this, 'AgenticOrchestrator', {
            stateMachineName: 'HivemindAgenticOrchestrator',
            definition,
            role: stepFunctionsRole,
            logs: {
                destination: new logs.LogGroup(this, 'StateMachineLogGroup', {
                    logGroupName: '/aws/stepfunctions/HivemindOrchestrator',
                    retention: logs.RetentionDays.ONE_WEEK,
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                }),
                level: sfn.LogLevel.ALL,
            },
            tracingEnabled: true,
            timeout: cdk.Duration.hours(1),
        });
        // Grant necessary permissions to Step Functions role
        // Grant Lambda invoke permissions here in Orchestration Stack
        // This is safe because Orchestration already depends on Compute
        stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [props.unpackLambda.functionArn],
        }));
        stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
            actions: ['ecs:RunTask', 'ecs:StopTask', 'ecs:DescribeTasks'],
            resources: ['*'],
        }));
        stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [
                ...Object.values(props.agentTaskDefinitions).map((td) => td.taskRole.roleArn),
                ...Object.values(props.agentTaskDefinitions).map((td) => td.executionRole.roleArn),
                ...Object.values(props.mcpTaskDefinitions).map((td) => td.taskRole.roleArn),
                ...Object.values(props.mcpTaskDefinitions).map((td) => td.executionRole.roleArn),
            ],
        }));
        stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
            actions: ['sns:Publish'],
            resources: [this.completionTopic.topicArn],
        }));
        stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
            actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
            resources: ['*'],
        }));
        // ========== EVENTBRIDGE RULE ==========
        // Create rule to trigger on S3 uploads
        this.eventRule = new events.Rule(this, 'CodeUploadTrigger', {
            ruleName: 'HivemindCodeUploadTrigger',
            description: 'Triggers Step Functions when code is uploaded to S3',
            eventPattern: {
                source: ['aws.s3'],
                detailType: ['Object Created'],
                detail: {
                    bucket: {
                        name: [props.uploadsBucket.bucketName],
                    },
                    object: {
                        key: [{ prefix: 'uploads/' }],
                    },
                },
            },
        });
        // Add Step Functions as target
        this.eventRule.addTarget(new targets.SfnStateMachine(this.stateMachine, {
            input: events.RuleTargetInput.fromEventPath('$'),
        }));
        // ========== OUTPUTS ==========
        new cdk.CfnOutput(this, 'StateMachineArn', {
            value: this.stateMachine.stateMachineArn,
            description: 'Step Functions State Machine ARN',
            exportName: 'HivemindPrism-StateMachineArn',
        });
        new cdk.CfnOutput(this, 'CompletionTopicArn', {
            value: this.completionTopic.topicArn,
            description: 'SNS Topic for completion notifications',
            exportName: 'HivemindPrism-CompletionTopicArn',
        });
    }
    createAgentTask(id, taskDefinition, props) {
        return new tasks.EcsRunTask(this, id, {
            integrationPattern: sfn.IntegrationPattern.RUN_JOB,
            cluster: props.ecsCluster,
            taskDefinition,
            launchTarget: new tasks.EcsFargateLaunchTarget({
                platformVersion: ecs.FargatePlatformVersion.LATEST,
            }),
            containerOverrides: [
                {
                    containerDefinition: taskDefinition.defaultContainer,
                    environment: [
                        {
                            name: 'MISSION_ID',
                            value: sfn.JsonPath.stringAt('$.mission_id'),
                        },
                    ],
                },
            ],
            securityGroups: [props.agentSecurityGroup],
            subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            resultPath: `$.${id.toLowerCase()}_result`,
        });
    }
}
exports.OrchestrationStack = OrchestrationStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JjaGVzdHJhdGlvbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9vcmNoZXN0cmF0aW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyxtRUFBcUQ7QUFDckQsMkVBQTZEO0FBQzdELCtEQUFpRDtBQUNqRCx3RUFBMEQ7QUFDMUQseURBQTJDO0FBRzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFFM0MseURBQTJDO0FBQzNDLDJEQUE2QztBQWU3QyxNQUFhLGtCQUFtQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBSy9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNENBQTRDO1FBQzVDLCtEQUErRDtRQUMvRCxpRUFBaUU7UUFDakUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLCtCQUErQixFQUFFO1lBQzVFLFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxRQUFRLEVBQUUsMkJBQTJCO1lBQ3JDLFdBQVcsRUFBRSxxREFBcUQ7U0FDbkUsQ0FBQyxDQUFDO1FBRUgsb0RBQW9EO1FBQ3BELElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUM1RCxTQUFTLEVBQUUsNEJBQTRCO1lBQ3ZDLFdBQVcsRUFBRSwyQ0FBMkM7U0FDekQsQ0FBQyxDQUFDO1FBRUgscURBQXFEO1FBRXJELHlCQUF5QjtRQUN6QixNQUFNLFVBQVUsR0FBRyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLG1C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QzNDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTNURCxnREEyVEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgc2ZuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCAqIGFzIHRhc2tzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgdXBsb2Fkc0J1Y2tldDogczMuQnVja2V0O1xuICBtaXNzaW9uU3RhdHVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBhZ2VudFRhc2tEZWZpbml0aW9uczogeyBba2V5OiBzdHJpbmddOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uIH07XG4gIG1jcFRhc2tEZWZpbml0aW9uczogeyBba2V5OiBzdHJpbmddOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uIH07XG4gIHVucGFja0xhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xuICBlY3NDbHVzdGVyOiBlY3MuQ2x1c3RlcjtcbiAgdnBjOiBlYzIuVnBjO1xuICBhZ2VudFNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBtY3BUb29sc1NlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xufVxuXG5leHBvcnQgY2xhc3MgT3JjaGVzdHJhdGlvblN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHN0YXRlTWFjaGluZTogc2ZuLlN0YXRlTWFjaGluZTtcbiAgcHVibGljIHJlYWRvbmx5IGV2ZW50UnVsZTogZXZlbnRzLlJ1bGU7XG4gIHB1YmxpYyByZWFkb25seSBjb21wbGV0aW9uVG9waWM6IHNucy5Ub3BpYztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogT3JjaGVzdHJhdGlvblN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vID09PT09PT09PT0gU1RFUCBGVU5DVElPTlMgUk9MRSA9PT09PT09PT09XG4gICAgLy8gQ3JlYXRlIFN0ZXAgRnVuY3Rpb25zIHJvbGUgaGVyZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5XG4gICAgLy8gKFNlY3VyaXR5IOKGkiBDb21wdXRlIOKGkiBJbnRlbGxpZ2VuY2Ug4oaSIFN0b3JhZ2Ug4oaSIFNlY3VyaXR5IGN5Y2xlKVxuICAgIGNvbnN0IHN0ZXBGdW5jdGlvbnNSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdTdGVwRnVuY3Rpb25zT3JjaGVzdHJhdG9yUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdzdGF0ZXMuYW1hem9uYXdzLmNvbScpLFxuICAgICAgcm9sZU5hbWU6ICdIaXZlbWluZFN0ZXBGdW5jdGlvbnNSb2xlJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUm9sZSBmb3IgU3RlcCBGdW5jdGlvbnMgc3RhdGUgbWFjaGluZSBvcmNoZXN0cmF0aW9uJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT0gU05TIFRPUElDIEZPUiBOT1RJRklDQVRJT05TID09PT09PT09PT1cbiAgICB0aGlzLmNvbXBsZXRpb25Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ0NvbXBsZXRpb25Ub3BpYycsIHtcbiAgICAgIHRvcGljTmFtZTogJ0hpdmVtaW5kTWlzc2lvbkNvbXBsZXRpb25zJyxcbiAgICAgIGRpc3BsYXlOYW1lOiAnSGl2ZW1pbmQgTWlzc2lvbiBDb21wbGV0aW9uIE5vdGlmaWNhdGlvbnMnLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PSBTVEVQIEZVTkNUSU9OUyBTVEFURSBNQUNISU5FID09PT09PT09PT1cblxuICAgIC8vIDEuIFVucGFjayBhbmQgVmFsaWRhdGVcbiAgICBjb25zdCB1bnBhY2tUYXNrID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnVW5wYWNrQW5kVmFsaWRhdGUnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogcHJvcHMudW5wYWNrTGFtYmRhLFxuICAgICAgb3V0cHV0UGF0aDogJyQuUGF5bG9hZCcsXG4gICAgICByZXRyeU9uU2VydmljZUV4Y2VwdGlvbnM6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyAyLiBDb29yZGluYXRvciBEZWNpc2lvblxuICAgIGNvbnN0IGNvb3JkaW5hdG9yVGFzayA9IHRoaXMuY3JlYXRlQWdlbnRUYXNrKFxuICAgICAgJ0Nvb3JkaW5hdG9yRGVjaXNpb24nLFxuICAgICAgcHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMuY29vcmRpbmF0b3IsXG4gICAgICBwcm9wc1xuICAgICk7XG5cbiAgICAvLyAzYS4gQVdTIFNjYW4gUGF0aCAtIEp1c3QgU3RyYXRlZ2lzdCAoc2tpcCBBcmNoYWVvbG9naXN0KVxuICAgIGNvbnN0IHN0cmF0ZWdpc3RUYXNrQVdTID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnU3RyYXRlZ2lzdFRhc2tBV1MnLFxuICAgICAgcHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMuc3RyYXRlZ2lzdCxcbiAgICAgIHByb3BzXG4gICAgKTtcbiAgICBzdHJhdGVnaXN0VGFza0FXUy5uZXh0KGNvb3JkaW5hdG9yVGFzayk7XG5cbiAgICAvLyAzYi4gQ29kZSBTY2FuIFBhdGggLSBEZXBsb3kgQ29udGV4dCBBZ2VudHMgKFBhcmFsbGVsKVxuICAgIGNvbnN0IGFyY2hhZW9sb2dpc3RUYXNrID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnQXJjaGFlb2xvZ2lzdFRhc2snLFxuICAgICAgcHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMuYXJjaGFlb2xvZ2lzdCxcbiAgICAgIHByb3BzXG4gICAgKTtcblxuICAgIGNvbnN0IHN0cmF0ZWdpc3RUYXNrID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnU3RyYXRlZ2lzdFRhc2snLFxuICAgICAgcHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMuc3RyYXRlZ2lzdCxcbiAgICAgIHByb3BzXG4gICAgKTtcblxuICAgIGNvbnN0IGNvbnRleHRBZ2VudHNQYXJhbGxlbCA9IG5ldyBzZm4uUGFyYWxsZWwodGhpcywgJ0RlcGxveUNvbnRleHRBZ2VudHMnLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5jb250ZXh0X3Jlc3VsdHMnLFxuICAgIH0pO1xuXG4gICAgY29udGV4dEFnZW50c1BhcmFsbGVsLmJyYW5jaChhcmNoYWVvbG9naXN0VGFzayk7XG4gICAgY29udGV4dEFnZW50c1BhcmFsbGVsLmJyYW5jaChzdHJhdGVnaXN0VGFzayk7XG4gICAgY29udGV4dEFnZW50c1BhcmFsbGVsLm5leHQoY29vcmRpbmF0b3JUYXNrKTtcblxuICAgIC8vIDNjLiBTY2FuIFR5cGUgRGVjaXNpb24gLSBCcmFuY2ggdG8gYXBwcm9wcmlhdGUgcGF0aFxuICAgIGNvbnN0IHNjYW5UeXBlQ2hvaWNlID0gbmV3IHNmbi5DaG9pY2UodGhpcywgJ1NjYW5UeXBlRGVjaXNpb24nKVxuICAgICAgLndoZW4oXG4gICAgICAgIHNmbi5Db25kaXRpb24uc3RyaW5nRXF1YWxzKCckLnNjYW5fdHlwZScsICdhd3MnKSxcbiAgICAgICAgc3RyYXRlZ2lzdFRhc2tBV1NcbiAgICAgIClcbiAgICAgIC5vdGhlcndpc2UoY29udGV4dEFnZW50c1BhcmFsbGVsKTtcblxuICAgIC8vIDQuIER5bmFtaWMgTUNQIEludm9jYXRpb24gKE1hcCBTdGF0ZSlcbiAgICBjb25zdCBtY3BJbnZvY2F0aW9uTWFwID0gbmV3IHNmbi5NYXAodGhpcywgJ0R5bmFtaWNNQ1BJbnZvY2F0aW9uJywge1xuICAgICAgbWF4Q29uY3VycmVuY3k6IDUsXG4gICAgICBpdGVtc1BhdGg6ICckLmV4ZWN1dGlvbl9wbGFuLnRvb2xzJyxcbiAgICAgIHJlc3VsdFBhdGg6ICckLm1jcF9yZXN1bHRzJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBNQ1AgdGFzayAod2lsbCBiZSBkeW5hbWljYWxseSBzZWxlY3RlZClcbiAgICBjb25zdCBtY3BUYXNrID0gbmV3IHRhc2tzLkVjc1J1blRhc2sodGhpcywgJ0ludm9rZU1DUFRvb2wnLCB7XG4gICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IHNmbi5JbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQixcbiAgICAgIGNsdXN0ZXI6IHByb3BzLmVjc0NsdXN0ZXIsXG4gICAgICB0YXNrRGVmaW5pdGlvbjogcHJvcHMubWNwVGFza0RlZmluaXRpb25zWydzZW1ncmVwLW1jcCddLCAvLyBEZWZhdWx0LCB3aWxsIGJlIG92ZXJyaWRkZW5cbiAgICAgIGxhdW5jaFRhcmdldDogbmV3IHRhc2tzLkVjc0ZhcmdhdGVMYXVuY2hUYXJnZXQoe1xuICAgICAgICBwbGF0Zm9ybVZlcnNpb246IGVjcy5GYXJnYXRlUGxhdGZvcm1WZXJzaW9uLkxBVEVTVCxcbiAgICAgIH0pLFxuICAgICAgY29udGFpbmVyT3ZlcnJpZGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjb250YWluZXJEZWZpbml0aW9uOiBwcm9wcy5tY3BUYXNrRGVmaW5pdGlvbnNbJ3NlbWdyZXAtbWNwJ10uZGVmYXVsdENvbnRhaW5lciEsXG4gICAgICAgICAgZW52aXJvbm1lbnQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogJ01JU1NJT05fSUQnLFxuICAgICAgICAgICAgICB2YWx1ZTogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLm1pc3Npb25faWQnKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW3Byb3BzLm1jcFRvb2xzU2VjdXJpdHlHcm91cF0sXG4gICAgICBzdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICB9KTtcblxuICAgIG1jcEludm9jYXRpb25NYXAuaXRlcmF0b3IobWNwVGFzayk7XG5cbiAgICAvLyA1LiBXYWl0IGZvciBTMyBDb25zaXN0ZW5jeVxuICAgIGNvbnN0IHdhaXRGb3JUb29scyA9IG5ldyBzZm4uV2FpdCh0aGlzLCAnV2FpdEZvckFsbFRvb2xzJywge1xuICAgICAgdGltZTogc2ZuLldhaXRUaW1lLmR1cmF0aW9uKGNkay5EdXJhdGlvbi5zZWNvbmRzKDUpKSxcbiAgICB9KTtcblxuICAgIC8vIDYuIFN5bnRoZXNpcyBDcnVjaWJsZSAoUGFyYWxsZWwpXG4gICAgY29uc3Qgc3ludGhlc2l6ZXJUYXNrID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnU3ludGhlc2l6ZXJUYXNrJyxcbiAgICAgIHByb3BzLmFnZW50VGFza0RlZmluaXRpb25zLnN5bnRoZXNpemVyLFxuICAgICAgcHJvcHNcbiAgICApO1xuXG4gICAgY29uc3QgY3JpdGljVGFzayA9IHRoaXMuY3JlYXRlQWdlbnRUYXNrKFxuICAgICAgJ0NyaXRpY1Rhc2snLFxuICAgICAgcHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMuY3JpdGljLFxuICAgICAgcHJvcHNcbiAgICApO1xuXG4gICAgY29uc3Qgc3ludGhlc2lzQ3J1Y2libGUgPSBuZXcgc2ZuLlBhcmFsbGVsKHRoaXMsICdMYXVuY2hTeW50aGVzaXNDcnVjaWJsZScsIHtcbiAgICAgIHJlc3VsdFBhdGg6ICckLnN5bnRoZXNpc19yZXN1bHRzJyxcbiAgICB9KTtcblxuICAgIHN5bnRoZXNpc0NydWNpYmxlLmJyYW5jaChzeW50aGVzaXplclRhc2spO1xuICAgIHN5bnRoZXNpc0NydWNpYmxlLmJyYW5jaChjcml0aWNUYXNrKTtcblxuICAgIC8vIDcuIFdhaXQgZm9yIE5lZ290aWF0aW9uXG4gICAgY29uc3Qgd2FpdEZvckNvbnNlbnN1cyA9IG5ldyBzZm4uV2FpdCh0aGlzLCAnV2FpdEZvckNvbnNlbnN1cycsIHtcbiAgICAgIHRpbWU6IHNmbi5XYWl0VGltZS5kdXJhdGlvbihjZGsuRHVyYXRpb24uc2Vjb25kcygxMCkpLFxuICAgIH0pO1xuXG4gICAgLy8gOC4gQXJjaGl2aXN0IFRhc2tcbiAgICBjb25zdCBhcmNoaXZpc3RUYXNrID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnQXJjaGl2aXN0VGFzaycsXG4gICAgICBwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucy5hcmNoaXZpc3QsXG4gICAgICBwcm9wc1xuICAgICk7XG5cbiAgICAvLyA5LiBOb3RpZnkgQ29tcGxldGlvblxuICAgIGNvbnN0IG5vdGlmeUNvbXBsZXRpb24gPSBuZXcgdGFza3MuU25zUHVibGlzaCh0aGlzLCAnTm90aWZ5Q29tcGxldGlvbicsIHtcbiAgICAgIHRvcGljOiB0aGlzLmNvbXBsZXRpb25Ub3BpYyxcbiAgICAgIG1lc3NhZ2U6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIG1pc3Npb25faWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5taXNzaW9uX2lkJyksXG4gICAgICAgIHN0YXR1czogJ0NPTVBMRVRFRCcsXG4gICAgICAgIGZpbmRpbmdzX2NvdW50OiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQuYXJjaGl2YWxfcmVzdWx0LmNvdW50JyksXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIDEwLiBGYWlsdXJlIEhhbmRsZXJcbiAgICBjb25zdCBoYW5kbGVGYWlsdXJlID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnSGFuZGxlRmFpbHVyZScsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBwcm9wcy51bnBhY2tMYW1iZGEsIC8vIFJldXNlIGZvciBzaW1wbGljaXR5LCBzaG91bGQgYmUgc2VwYXJhdGVcbiAgICAgIHBheWxvYWQ6IHNmbi5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIG1pc3Npb25faWQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5taXNzaW9uX2lkJyksXG4gICAgICAgIGVycm9yOiBzZm4uSnNvblBhdGguc3RyaW5nQXQoJyQuZXJyb3InKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZmFpbHVyZUVuZCA9IG5ldyBzZm4uU3VjY2VlZCh0aGlzLCAnRmFpbHVyZVJlY29yZGVkJyk7XG5cbiAgICAvLyBDaGFpbiB0aGUgc3RhdGVzOiB1bnBhY2sgLT4gc2NhbiB0eXBlIGNob2ljZSAtPiAoYXdzL2NvZGUgcGF0aHMpIC0+IGNvb3JkaW5hdG9yIC0+IHJlc3RcbiAgICBjb25zdCBkZWZpbml0aW9uID0gdW5wYWNrVGFza1xuICAgICAgLm5leHQoc2NhblR5cGVDaG9pY2UpO1xuICAgIFxuICAgIC8vIEFmdGVyIGNvb3JkaW5hdG9yLCBjb250aW51ZSB3aXRoIGNvbW1vbiBwYXRoXG4gICAgY29vcmRpbmF0b3JUYXNrXG4gICAgICAubmV4dChtY3BJbnZvY2F0aW9uTWFwKVxuICAgICAgLm5leHQod2FpdEZvclRvb2xzKVxuICAgICAgLm5leHQoc3ludGhlc2lzQ3J1Y2libGUpXG4gICAgICAubmV4dCh3YWl0Rm9yQ29uc2Vuc3VzKVxuICAgICAgLm5leHQoYXJjaGl2aXN0VGFzaylcbiAgICAgIC5uZXh0KG5vdGlmeUNvbXBsZXRpb24pO1xuXG4gICAgLy8gQWRkIGVycm9yIGhhbmRsaW5nXG4gICAgdW5wYWNrVGFzay5hZGRDYXRjaChoYW5kbGVGYWlsdXJlLm5leHQoZmFpbHVyZUVuZCksIHtcbiAgICAgIGVycm9yczogWydTdGF0ZXMuQUxMJ10sXG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgU3RhdGUgTWFjaGluZVxuICAgIHRoaXMuc3RhdGVNYWNoaW5lID0gbmV3IHNmbi5TdGF0ZU1hY2hpbmUodGhpcywgJ0FnZW50aWNPcmNoZXN0cmF0b3InLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnSGl2ZW1pbmRBZ2VudGljT3JjaGVzdHJhdG9yJyxcbiAgICAgIGRlZmluaXRpb24sXG4gICAgICByb2xlOiBzdGVwRnVuY3Rpb25zUm9sZSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdTdGF0ZU1hY2hpbmVMb2dHcm91cCcsIHtcbiAgICAgICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL3N0ZXBmdW5jdGlvbnMvSGl2ZW1pbmRPcmNoZXN0cmF0b3InLFxuICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pLFxuICAgICAgICBsZXZlbDogc2ZuLkxvZ0xldmVsLkFMTCxcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IG5lY2Vzc2FyeSBwZXJtaXNzaW9ucyB0byBTdGVwIEZ1bmN0aW9ucyByb2xlXG4gICAgLy8gR3JhbnQgTGFtYmRhIGludm9rZSBwZXJtaXNzaW9ucyBoZXJlIGluIE9yY2hlc3RyYXRpb24gU3RhY2tcbiAgICAvLyBUaGlzIGlzIHNhZmUgYmVjYXVzZSBPcmNoZXN0cmF0aW9uIGFscmVhZHkgZGVwZW5kcyBvbiBDb21wdXRlXG4gICAgc3RlcEZ1bmN0aW9uc1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJ10sXG4gICAgICAgIHJlc291cmNlczogW3Byb3BzLnVucGFja0xhbWJkYS5mdW5jdGlvbkFybl0sXG4gICAgICB9KVxuICAgICk7XG4gICAgXG4gICAgc3RlcEZ1bmN0aW9uc1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnZWNzOlJ1blRhc2snLCAnZWNzOlN0b3BUYXNrJywgJ2VjczpEZXNjcmliZVRhc2tzJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBzdGVwRnVuY3Rpb25zUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydpYW06UGFzc1JvbGUnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgLi4uT2JqZWN0LnZhbHVlcyhwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucykubWFwKCh0ZCkgPT4gdGQudGFza1JvbGUucm9sZUFybiksXG4gICAgICAgICAgLi4uT2JqZWN0LnZhbHVlcyhwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucykubWFwKCh0ZCkgPT4gdGQuZXhlY3V0aW9uUm9sZSEucm9sZUFybiksXG4gICAgICAgICAgLi4uT2JqZWN0LnZhbHVlcyhwcm9wcy5tY3BUYXNrRGVmaW5pdGlvbnMpLm1hcCgodGQpID0+IHRkLnRhc2tSb2xlLnJvbGVBcm4pLFxuICAgICAgICAgIC4uLk9iamVjdC52YWx1ZXMocHJvcHMubWNwVGFza0RlZmluaXRpb25zKS5tYXAoKHRkKSA9PiB0ZC5leGVjdXRpb25Sb2xlIS5yb2xlQXJuKSxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHN0ZXBGdW5jdGlvbnNSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ3NuczpQdWJsaXNoJ10sXG4gICAgICAgIHJlc291cmNlczogW3RoaXMuY29tcGxldGlvblRvcGljLnRvcGljQXJuXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIHN0ZXBGdW5jdGlvbnNSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ2V2ZW50czpQdXRUYXJnZXRzJywgJ2V2ZW50czpQdXRSdWxlJywgJ2V2ZW50czpEZXNjcmliZVJ1bGUnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vID09PT09PT09PT0gRVZFTlRCUklER0UgUlVMRSA9PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgcnVsZSB0byB0cmlnZ2VyIG9uIFMzIHVwbG9hZHNcbiAgICB0aGlzLmV2ZW50UnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnQ29kZVVwbG9hZFRyaWdnZXInLCB7XG4gICAgICBydWxlTmFtZTogJ0hpdmVtaW5kQ29kZVVwbG9hZFRyaWdnZXInLFxuICAgICAgZGVzY3JpcHRpb246ICdUcmlnZ2VycyBTdGVwIEZ1bmN0aW9ucyB3aGVuIGNvZGUgaXMgdXBsb2FkZWQgdG8gUzMnLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydhd3MuczMnXSxcbiAgICAgICAgZGV0YWlsVHlwZTogWydPYmplY3QgQ3JlYXRlZCddLFxuICAgICAgICBkZXRhaWw6IHtcbiAgICAgICAgICBidWNrZXQ6IHtcbiAgICAgICAgICAgIG5hbWU6IFtwcm9wcy51cGxvYWRzQnVja2V0LmJ1Y2tldE5hbWVdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgb2JqZWN0OiB7XG4gICAgICAgICAgICBrZXk6IFt7IHByZWZpeDogJ3VwbG9hZHMvJyB9XSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBTdGVwIEZ1bmN0aW9ucyBhcyB0YXJnZXRcbiAgICB0aGlzLmV2ZW50UnVsZS5hZGRUYXJnZXQoXG4gICAgICBuZXcgdGFyZ2V0cy5TZm5TdGF0ZU1hY2hpbmUodGhpcy5zdGF0ZU1hY2hpbmUsIHtcbiAgICAgICAgaW5wdXQ6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbUV2ZW50UGF0aCgnJCcpLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PSBPVVRQVVRTID09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTdGF0ZU1hY2hpbmVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zdGF0ZU1hY2hpbmUuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTdGVwIEZ1bmN0aW9ucyBTdGF0ZSBNYWNoaW5lIEFSTicsXG4gICAgICBleHBvcnROYW1lOiAnSGl2ZW1pbmRQcmlzbS1TdGF0ZU1hY2hpbmVBcm4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvbXBsZXRpb25Ub3BpY0FybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNvbXBsZXRpb25Ub3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFRvcGljIGZvciBjb21wbGV0aW9uIG5vdGlmaWNhdGlvbnMnLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tQ29tcGxldGlvblRvcGljQXJuJyxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlQWdlbnRUYXNrKFxuICAgIGlkOiBzdHJpbmcsXG4gICAgdGFza0RlZmluaXRpb246IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24sXG4gICAgcHJvcHM6IE9yY2hlc3RyYXRpb25TdGFja1Byb3BzXG4gICk6IHRhc2tzLkVjc1J1blRhc2sge1xuICAgIHJldHVybiBuZXcgdGFza3MuRWNzUnVuVGFzayh0aGlzLCBpZCwge1xuICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBzZm4uSW50ZWdyYXRpb25QYXR0ZXJuLlJVTl9KT0IsXG4gICAgICBjbHVzdGVyOiBwcm9wcy5lY3NDbHVzdGVyLFxuICAgICAgdGFza0RlZmluaXRpb24sXG4gICAgICBsYXVuY2hUYXJnZXQ6IG5ldyB0YXNrcy5FY3NGYXJnYXRlTGF1bmNoVGFyZ2V0KHtcbiAgICAgICAgcGxhdGZvcm1WZXJzaW9uOiBlY3MuRmFyZ2F0ZVBsYXRmb3JtVmVyc2lvbi5MQVRFU1QsXG4gICAgICB9KSxcbiAgICAgIGNvbnRhaW5lck92ZXJyaWRlczogW1xuICAgICAgICB7XG4gICAgICAgICAgY29udGFpbmVyRGVmaW5pdGlvbjogdGFza0RlZmluaXRpb24uZGVmYXVsdENvbnRhaW5lciEsXG4gICAgICAgICAgZW52aXJvbm1lbnQ6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogJ01JU1NJT05fSUQnLFxuICAgICAgICAgICAgICB2YWx1ZTogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLm1pc3Npb25faWQnKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW3Byb3BzLmFnZW50U2VjdXJpdHlHcm91cF0sXG4gICAgICBzdWJuZXRzOiB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgIHJlc3VsdFBhdGg6IGAkLiR7aWQudG9Mb3dlckNhc2UoKX1fcmVzdWx0YCxcbiAgICB9KTtcbiAgfVxufSJdfQ==