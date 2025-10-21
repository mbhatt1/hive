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
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cloudwatch_actions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
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
        // 4. Synthesis Crucible (Parallel)
        // Note: Coordinator agent internally manages MCP tool invocation via MCPToolRegistry
        // MCP servers are spawned as child processes and communicate via stdio (JSON-RPC 2.0)
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
            lambdaFunction: props.failureHandlerLambda,
            payload: sfn.TaskInput.fromObject({
                mission_id: sfn.JsonPath.stringAt('$.mission_id'),
                error: sfn.JsonPath.stringAt('$.error'),
            }),
        });
        const failureEnd = new sfn.Succeed(this, 'FailureRecorded');
        // Chain the states: unpack -> scan type choice -> (aws/code paths) -> coordinator -> synthesis -> archivist
        const definition = unpackTask
            .next(scanTypeChoice);
        // After coordinator (which internally handles MCP tool execution), continue with synthesis
        coordinatorTask
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
            resources: [props.unpackLambda.functionArn, props.failureHandlerLambda.functionArn],
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
                // MCP tools no longer run as separate ECS tasks
                // They are managed as child processes by the Coordinator agent
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
        // ========== CLOUDWATCH ALARMS ==========
        // Alarm for Step Functions execution failures
        const executionFailureAlarm = new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
            alarmName: 'Hivemind-StateMachine-Failures',
            alarmDescription: 'Alert when Step Functions execution fails',
            metric: this.stateMachine.metricFailed({
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        executionFailureAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.completionTopic));
        // Alarm for long-running executions (> 45 minutes)
        const executionDurationMetric = new cloudwatch.Metric({
            namespace: 'AWS/States',
            metricName: 'ExecutionTime',
            dimensionsMap: {
                StateMachineArn: this.stateMachine.stateMachineArn,
            },
            statistic: 'Maximum',
            period: cdk.Duration.minutes(5),
        });
        const longRunningAlarm = new cloudwatch.Alarm(this, 'LongRunningExecutionAlarm', {
            alarmName: 'Hivemind-StateMachine-LongRunning',
            alarmDescription: 'Alert when Step Functions execution runs longer than 45 minutes',
            metric: executionDurationMetric,
            threshold: 45 * 60 * 1000, // 45 minutes in milliseconds
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        longRunningAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.completionTopic));
        // Alarm for MCP task failures (ScoutSuite and Pacu)
        const mcpFailureMetric = new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'TasksFailed',
            dimensionsMap: {
                ClusterName: props.ecsCluster.clusterName,
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
        });
        const mcpTaskFailureAlarm = new cloudwatch.Alarm(this, 'MCPTaskFailureAlarm', {
            alarmName: 'Hivemind-MCP-Task-Failures',
            alarmDescription: 'Alert when MCP tasks fail',
            metric: mcpFailureMetric,
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        mcpTaskFailureAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.completionTopic));
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
            subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            resultPath: `$.${id.toLowerCase()}_result`,
        });
    }
}
exports.OrchestrationStack = OrchestrationStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JjaGVzdHJhdGlvbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2luZnJhc3RydWN0dXJlL3N0YWNrcy9vcmNoZXN0cmF0aW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyxtRUFBcUQ7QUFDckQsMkVBQTZEO0FBQzdELCtEQUFpRDtBQUNqRCx3RUFBMEQ7QUFDMUQseURBQTJDO0FBRzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFFM0MseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3Qyx1RUFBeUQ7QUFDekQsdUZBQXlFO0FBZXpFLE1BQWEsa0JBQW1CLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFLL0MsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw0Q0FBNEM7UUFDNUMsK0RBQStEO1FBQy9ELGlFQUFpRTtRQUNqRSxNQUFNLGlCQUFpQixHQUFHLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsK0JBQStCLEVBQUU7WUFDNUUsU0FBUyxFQUFFLElBQUksR0FBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDO1lBQzNELFFBQVEsRUFBRSwyQkFBMkI7WUFDckMsV0FBVyxFQUFFLHFEQUFxRDtTQUNuRSxDQUFDLENBQUM7UUFFSCxvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQzVELFNBQVMsRUFBRSw0QkFBNEI7WUFDdkMsV0FBVyxFQUFFLDJDQUEyQztTQUN6RCxDQUFDLENBQUM7UUFFSCxxREFBcUQ7UUFFckQseUJBQXlCO1FBQ3pCLE1BQU0sVUFBVSxHQUFHLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDbkUsY0FBYyxFQUFFLEtBQUssQ0FBQyxZQUFZO1lBQ2xDLFVBQVUsRUFBRSxXQUFXO1lBQ3ZCLHdCQUF3QixFQUFFLElBQUk7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsMEJBQTBCO1FBQzFCLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQzFDLHFCQUFxQixFQUNyQixLQUFLLENBQUMsb0JBQW9CLENBQUMsV0FBVyxFQUN0QyxLQUFLLENBQ04sQ0FBQztRQUVGLDJEQUEyRDtRQUMzRCxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxlQUFlLENBQzVDLG1CQUFtQixFQUNuQixLQUFLLENBQUMsb0JBQW9CLENBQUMsVUFBVSxFQUNyQyxLQUFLLENBQ04sQ0FBQztRQUNGLGlCQUFpQixDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUV4Qyx3REFBd0Q7UUFDeEQsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUM1QyxtQkFBbUIsRUFDbkIsS0FBSyxDQUFDLG9CQUFvQixDQUFDLGFBQWEsRUFDeEMsS0FBSyxDQUNOLENBQUM7UUFFRixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUN6QyxnQkFBZ0IsRUFDaEIsS0FBSyxDQUFDLG9CQUFvQixDQUFDLFVBQVUsRUFDckMsS0FBSyxDQUNOLENBQUM7UUFFRixNQUFNLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDMUUsVUFBVSxFQUFFLG1CQUFtQjtTQUNoQyxDQUFDLENBQUM7UUFFSCxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNoRCxxQkFBcUIsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLENBQUM7UUFDN0MscUJBQXFCLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRTVDLHNEQUFzRDtRQUN0RCxNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGtCQUFrQixDQUFDO2FBQzVELElBQUksQ0FDSCxHQUFHLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUUsS0FBSyxDQUFDLEVBQ2hELGlCQUFpQixDQUNsQjthQUNBLFNBQVMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBRXBDLG1DQUFtQztRQUNuQyxxRkFBcUY7UUFDckYsc0ZBQXNGO1FBQ3RGLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQzFDLGlCQUFpQixFQUNqQixLQUFLLENBQUMsb0JBQW9CLENBQUMsV0FBVyxFQUN0QyxLQUFLLENBQ04sQ0FBQztRQUVGLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQ3JDLFlBQVksRUFDWixLQUFLLENBQUMsb0JBQW9CLENBQUMsTUFBTSxFQUNqQyxLQUFLLENBQ04sQ0FBQztRQUVGLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUMxRSxVQUFVLEVBQUUscUJBQXFCO1NBQ2xDLENBQUMsQ0FBQztRQUVILGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUMxQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFckMsMEJBQTBCO1FBQzFCLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUM5RCxJQUFJLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsb0JBQW9CO1FBQ3BCLE1BQU0sYUFBYSxHQUFHLElBQUksQ0FBQyxlQUFlLENBQ3hDLGVBQWUsRUFDZixLQUFLLENBQUMsb0JBQW9CLENBQUMsU0FBUyxFQUNwQyxLQUFLLENBQ04sQ0FBQztRQUVGLHVCQUF1QjtRQUN2QixNQUFNLGdCQUFnQixHQUFHLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDdEUsS0FBSyxFQUFFLElBQUksQ0FBQyxlQUFlO1lBQzNCLE9BQU8sRUFBRSxHQUFHLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztnQkFDaEMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQztnQkFDakQsTUFBTSxFQUFFLFdBQVc7Z0JBQ25CLGNBQWMsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyx5QkFBeUIsQ0FBQzthQUNqRSxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsc0JBQXNCO1FBQ3RCLE1BQU0sYUFBYSxHQUFHLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ2xFLGNBQWMsRUFBRSxLQUFLLENBQUMsb0JBQW9CO1lBQzFDLE9BQU8sRUFBRSxHQUFHLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztnQkFDaEMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQztnQkFDakQsS0FBSyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQzthQUN4QyxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBRTVELDRHQUE0RztRQUM1RyxNQUFNLFVBQVUsR0FBRyxVQUFVO2FBQzFCLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUV4QiwyRkFBMkY7UUFDM0YsZUFBZTthQUNaLElBQUksQ0FBQyxpQkFBaUIsQ0FBQzthQUN2QixJQUFJLENBQUMsZ0JBQWdCLENBQUM7YUFDdEIsSUFBSSxDQUFDLGFBQWEsQ0FBQzthQUNuQixJQUFJLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztRQUUxQixxQkFBcUI7UUFDckIsVUFBVSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQ2xELE1BQU0sRUFBRSxDQUFDLFlBQVksQ0FBQztZQUN0QixVQUFVLEVBQUUsU0FBUztTQUN0QixDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLEdBQUcsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQ3BFLGdCQUFnQixFQUFFLDZCQUE2QjtZQUMvQyxVQUFVO1lBQ1YsSUFBSSxFQUFFLGlCQUFpQjtZQUN2QixJQUFJLEVBQUU7Z0JBQ0osV0FBVyxFQUFFLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7b0JBQzNELFlBQVksRUFBRSx5Q0FBeUM7b0JBQ3ZELFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVE7b0JBQ3RDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87aUJBQ3pDLENBQUM7Z0JBQ0YsS0FBSyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsR0FBRzthQUN4QjtZQUNELGNBQWMsRUFBRSxJQUFJO1lBQ3BCLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7U0FDL0IsQ0FBQyxDQUFDO1FBRUgscURBQXFEO1FBQ3JELDhEQUE4RDtRQUM5RCxnRUFBZ0U7UUFDaEUsaUJBQWlCLENBQUMsV0FBVyxDQUMzQixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsT0FBTyxFQUFFLENBQUMsdUJBQXVCLENBQUM7WUFDbEMsU0FBUyxFQUFFLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLG9CQUFvQixDQUFDLFdBQVcsQ0FBQztTQUNwRixDQUFDLENBQ0gsQ0FBQztRQUVGLGlCQUFpQixDQUFDLFdBQVcsQ0FDM0IsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3RCLE9BQU8sRUFBRSxDQUFDLGFBQWEsRUFBRSxjQUFjLEVBQUUsbUJBQW1CLENBQUM7WUFDN0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFDO1FBRUYsaUJBQWlCLENBQUMsV0FBVyxDQUMzQixJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDdEIsT0FBTyxFQUFFLENBQUMsY0FBYyxDQUFDO1lBQ3pCLFNBQVMsRUFBRTtnQkFDVCxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLG9CQUFvQixDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQztnQkFDN0UsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDLGFBQWMsQ0FBQyxPQUFPLENBQUM7Z0JBQ25GLGdEQUFnRDtnQkFDaEQsK0RBQStEO2FBQ2hFO1NBQ0YsQ0FBQyxDQUNILENBQUM7UUFFRixpQkFBaUIsQ0FBQyxXQUFXLENBQzNCLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDeEIsU0FBUyxFQUFFLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxRQUFRLENBQUM7U0FDM0MsQ0FBQyxDQUNILENBQUM7UUFFRixpQkFBaUIsQ0FBQyxXQUFXLENBQzNCLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUN0QixPQUFPLEVBQUUsQ0FBQyxtQkFBbUIsRUFBRSxnQkFBZ0IsRUFBRSxxQkFBcUIsQ0FBQztZQUN2RSxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUNILENBQUM7UUFFRix5Q0FBeUM7UUFFekMsdUNBQXVDO1FBQ3ZDLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMxRCxRQUFRLEVBQUUsMkJBQTJCO1lBQ3JDLFdBQVcsRUFBRSxxREFBcUQ7WUFDbEUsWUFBWSxFQUFFO2dCQUNaLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQztnQkFDbEIsVUFBVSxFQUFFLENBQUMsZ0JBQWdCLENBQUM7Z0JBQzlCLE1BQU0sRUFBRTtvQkFDTixNQUFNLEVBQUU7d0JBQ04sSUFBSSxFQUFFLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7cUJBQ3ZDO29CQUNELE1BQU0sRUFBRTt3QkFDTixHQUFHLEVBQUUsQ0FBQyxFQUFFLE1BQU0sRUFBRSxVQUFVLEVBQUUsQ0FBQztxQkFDOUI7aUJBQ0Y7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILCtCQUErQjtRQUMvQixJQUFJLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FDdEIsSUFBSSxPQUFPLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDN0MsS0FBSyxFQUFFLE1BQU0sQ0FBQyxlQUFlLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQztTQUNqRCxDQUFDLENBQ0gsQ0FBQztRQUVGLDBDQUEwQztRQUUxQyw4Q0FBOEM7UUFDOUMsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQ2hGLFNBQVMsRUFBRSxnQ0FBZ0M7WUFDM0MsZ0JBQWdCLEVBQUUsMkNBQTJDO1lBQzdELE1BQU0sRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQztnQkFDckMsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7YUFDaEMsQ0FBQztZQUNGLFNBQVMsRUFBRSxDQUFDO1lBQ1osaUJBQWlCLEVBQUUsQ0FBQztZQUNwQixrQkFBa0IsRUFBRSxVQUFVLENBQUMsa0JBQWtCLENBQUMsa0NBQWtDO1lBQ3BGLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUVILHFCQUFxQixDQUFDLGNBQWMsQ0FBQyxJQUFJLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQztRQUU3RixtREFBbUQ7UUFDbkQsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7WUFDcEQsU0FBUyxFQUFFLFlBQVk7WUFDdkIsVUFBVSxFQUFFLGVBQWU7WUFDM0IsYUFBYSxFQUFFO2dCQUNiLGVBQWUsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLGVBQWU7YUFDbkQ7WUFDRCxTQUFTLEVBQUUsU0FBUztZQUNwQixNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1NBQ2hDLENBQUMsQ0FBQztRQUVILE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUMvRSxTQUFTLEVBQUUsbUNBQW1DO1lBQzlDLGdCQUFnQixFQUFFLGlFQUFpRTtZQUNuRixNQUFNLEVBQUUsdUJBQXVCO1lBQy9CLFNBQVMsRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLElBQUksRUFBRSw2QkFBNkI7WUFDeEQsaUJBQWlCLEVBQUUsQ0FBQztZQUNwQixrQkFBa0IsRUFBRSxVQUFVLENBQUMsa0JBQWtCLENBQUMsc0JBQXNCO1lBQ3hFLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUVILGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxJQUFJLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQztRQUV4RixvREFBb0Q7UUFDcEQsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7WUFDN0MsU0FBUyxFQUFFLFNBQVM7WUFDcEIsVUFBVSxFQUFFLGFBQWE7WUFDekIsYUFBYSxFQUFFO2dCQUNiLFdBQVcsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLFdBQVc7YUFDMUM7WUFDRCxTQUFTLEVBQUUsS0FBSztZQUNoQixNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1NBQ2hDLENBQUMsQ0FBQztRQUVILE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUM1RSxTQUFTLEVBQUUsNEJBQTRCO1lBQ3ZDLGdCQUFnQixFQUFFLDJCQUEyQjtZQUM3QyxNQUFNLEVBQUUsZ0JBQWdCO1lBQ3hCLFNBQVMsRUFBRSxDQUFDO1lBQ1osaUJBQWlCLEVBQUUsQ0FBQztZQUNwQixrQkFBa0IsRUFBRSxVQUFVLENBQUMsa0JBQWtCLENBQUMsa0NBQWtDO1lBQ3BGLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUVILG1CQUFtQixDQUFDLGNBQWMsQ0FBQyxJQUFJLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQztRQUUzRixnQ0FBZ0M7UUFFaEMsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxlQUFlO1lBQ3hDLFdBQVcsRUFBRSxrQ0FBa0M7WUFDL0MsVUFBVSxFQUFFLCtCQUErQjtTQUM1QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLFFBQVE7WUFDcEMsV0FBVyxFQUFFLHdDQUF3QztZQUNyRCxVQUFVLEVBQUUsa0NBQWtDO1NBQy9DLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxlQUFlLENBQ3JCLEVBQVUsRUFDVixjQUF5QyxFQUN6QyxLQUE4QjtRQUU5QixPQUFPLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxFQUFFO1lBQ3BDLGtCQUFrQixFQUFFLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPO1lBQ2xELE9BQU8sRUFBRSxLQUFLLENBQUMsVUFBVTtZQUN6QixjQUFjO1lBQ2QsWUFBWSxFQUFFLElBQUksS0FBSyxDQUFDLHNCQUFzQixDQUFDO2dCQUM3QyxlQUFlLEVBQUUsR0FBRyxDQUFDLHNCQUFzQixDQUFDLE1BQU07YUFDbkQsQ0FBQztZQUNGLGtCQUFrQixFQUFFO2dCQUNsQjtvQkFDRSxtQkFBbUIsRUFBRSxjQUFjLENBQUMsZ0JBQWlCO29CQUNyRCxXQUFXLEVBQUU7d0JBQ1g7NEJBQ0UsSUFBSSxFQUFFLFlBQVk7NEJBQ2xCLEtBQUssRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUM7eUJBQzdDO3FCQUNGO2lCQUNGO2FBQ0Y7WUFDRCxjQUFjLEVBQUUsQ0FBQyxLQUFLLENBQUMsa0JBQWtCLENBQUM7WUFDMUMsT0FBTyxFQUFFLEVBQUUsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLEVBQUU7WUFDeEQsVUFBVSxFQUFFLEtBQUssRUFBRSxDQUFDLFdBQVcsRUFBRSxTQUFTO1NBQzNDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FLRjtBQTFWRCxnREEwVkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgc2ZuIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCAqIGFzIHRhc2tzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zLXRhc2tzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZHdhdGNoJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2hfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9yY2hlc3RyYXRpb25TdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICB1cGxvYWRzQnVja2V0OiBzMy5CdWNrZXQ7XG4gIG1pc3Npb25TdGF0dXNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIGFnZW50VGFza0RlZmluaXRpb25zOiB7IFtrZXk6IHN0cmluZ106IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24gfTtcbiAgdW5wYWNrTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XG4gIGZhaWx1cmVIYW5kbGVyTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XG4gIGVjc0NsdXN0ZXI6IGVjcy5DbHVzdGVyO1xuICB2cGM6IGVjMi5WcGM7XG4gIGFnZW50U2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG4gIG1jcFRvb2xzU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG59XG5cbmV4cG9ydCBjbGFzcyBPcmNoZXN0cmF0aW9uU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgc3RhdGVNYWNoaW5lOiBzZm4uU3RhdGVNYWNoaW5lO1xuICBwdWJsaWMgcmVhZG9ubHkgZXZlbnRSdWxlOiBldmVudHMuUnVsZTtcbiAgcHVibGljIHJlYWRvbmx5IGNvbXBsZXRpb25Ub3BpYzogc25zLlRvcGljO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gPT09PT09PT09PSBTVEVQIEZVTkNUSU9OUyBST0xFID09PT09PT09PT1cbiAgICAvLyBDcmVhdGUgU3RlcCBGdW5jdGlvbnMgcm9sZSBoZXJlIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY3lcbiAgICAvLyAoU2VjdXJpdHkg4oaSIENvbXB1dGUg4oaSIEludGVsbGlnZW5jZSDihpIgU3RvcmFnZSDihpIgU2VjdXJpdHkgY3ljbGUpXG4gICAgY29uc3Qgc3RlcEZ1bmN0aW9uc1JvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1N0ZXBGdW5jdGlvbnNPcmNoZXN0cmF0b3JSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3N0YXRlcy5hbWF6b25hd3MuY29tJyksXG4gICAgICByb2xlTmFtZTogJ0hpdmVtaW5kU3RlcEZ1bmN0aW9uc1JvbGUnLFxuICAgICAgZGVzY3JpcHRpb246ICdSb2xlIGZvciBTdGVwIEZ1bmN0aW9ucyBzdGF0ZSBtYWNoaW5lIG9yY2hlc3RyYXRpb24nLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PSBTTlMgVE9QSUMgRk9SIE5PVElGSUNBVElPTlMgPT09PT09PT09PVxuICAgIHRoaXMuY29tcGxldGlvblRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQ29tcGxldGlvblRvcGljJywge1xuICAgICAgdG9waWNOYW1lOiAnSGl2ZW1pbmRNaXNzaW9uQ29tcGxldGlvbnMnLFxuICAgICAgZGlzcGxheU5hbWU6ICdIaXZlbWluZCBNaXNzaW9uIENvbXBsZXRpb24gTm90aWZpY2F0aW9ucycsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09IFNURVAgRlVOQ1RJT05TIFNUQVRFIE1BQ0hJTkUgPT09PT09PT09PVxuXG4gICAgLy8gMS4gVW5wYWNrIGFuZCBWYWxpZGF0ZVxuICAgIGNvbnN0IHVucGFja1Rhc2sgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdVbnBhY2tBbmRWYWxpZGF0ZScsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBwcm9wcy51bnBhY2tMYW1iZGEsXG4gICAgICBvdXRwdXRQYXRoOiAnJC5QYXlsb2FkJyxcbiAgICAgIHJldHJ5T25TZXJ2aWNlRXhjZXB0aW9uczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIDIuIENvb3JkaW5hdG9yIERlY2lzaW9uXG4gICAgY29uc3QgY29vcmRpbmF0b3JUYXNrID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnQ29vcmRpbmF0b3JEZWNpc2lvbicsXG4gICAgICBwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucy5jb29yZGluYXRvcixcbiAgICAgIHByb3BzXG4gICAgKTtcblxuICAgIC8vIDNhLiBBV1MgU2NhbiBQYXRoIC0gSnVzdCBTdHJhdGVnaXN0IChza2lwIEFyY2hhZW9sb2dpc3QpXG4gICAgY29uc3Qgc3RyYXRlZ2lzdFRhc2tBV1MgPSB0aGlzLmNyZWF0ZUFnZW50VGFzayhcbiAgICAgICdTdHJhdGVnaXN0VGFza0FXUycsXG4gICAgICBwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucy5zdHJhdGVnaXN0LFxuICAgICAgcHJvcHNcbiAgICApO1xuICAgIHN0cmF0ZWdpc3RUYXNrQVdTLm5leHQoY29vcmRpbmF0b3JUYXNrKTtcblxuICAgIC8vIDNiLiBDb2RlIFNjYW4gUGF0aCAtIERlcGxveSBDb250ZXh0IEFnZW50cyAoUGFyYWxsZWwpXG4gICAgY29uc3QgYXJjaGFlb2xvZ2lzdFRhc2sgPSB0aGlzLmNyZWF0ZUFnZW50VGFzayhcbiAgICAgICdBcmNoYWVvbG9naXN0VGFzaycsXG4gICAgICBwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucy5hcmNoYWVvbG9naXN0LFxuICAgICAgcHJvcHNcbiAgICApO1xuXG4gICAgY29uc3Qgc3RyYXRlZ2lzdFRhc2sgPSB0aGlzLmNyZWF0ZUFnZW50VGFzayhcbiAgICAgICdTdHJhdGVnaXN0VGFzaycsXG4gICAgICBwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucy5zdHJhdGVnaXN0LFxuICAgICAgcHJvcHNcbiAgICApO1xuXG4gICAgY29uc3QgY29udGV4dEFnZW50c1BhcmFsbGVsID0gbmV3IHNmbi5QYXJhbGxlbCh0aGlzLCAnRGVwbG95Q29udGV4dEFnZW50cycsIHtcbiAgICAgIHJlc3VsdFBhdGg6ICckLmNvbnRleHRfcmVzdWx0cycsXG4gICAgfSk7XG5cbiAgICBjb250ZXh0QWdlbnRzUGFyYWxsZWwuYnJhbmNoKGFyY2hhZW9sb2dpc3RUYXNrKTtcbiAgICBjb250ZXh0QWdlbnRzUGFyYWxsZWwuYnJhbmNoKHN0cmF0ZWdpc3RUYXNrKTtcbiAgICBjb250ZXh0QWdlbnRzUGFyYWxsZWwubmV4dChjb29yZGluYXRvclRhc2spO1xuXG4gICAgLy8gM2MuIFNjYW4gVHlwZSBEZWNpc2lvbiAtIEJyYW5jaCB0byBhcHByb3ByaWF0ZSBwYXRoXG4gICAgY29uc3Qgc2NhblR5cGVDaG9pY2UgPSBuZXcgc2ZuLkNob2ljZSh0aGlzLCAnU2NhblR5cGVEZWNpc2lvbicpXG4gICAgICAud2hlbihcbiAgICAgICAgc2ZuLkNvbmRpdGlvbi5zdHJpbmdFcXVhbHMoJyQuc2Nhbl90eXBlJywgJ2F3cycpLFxuICAgICAgICBzdHJhdGVnaXN0VGFza0FXU1xuICAgICAgKVxuICAgICAgLm90aGVyd2lzZShjb250ZXh0QWdlbnRzUGFyYWxsZWwpO1xuXG4gICAgLy8gNC4gU3ludGhlc2lzIENydWNpYmxlIChQYXJhbGxlbClcbiAgICAvLyBOb3RlOiBDb29yZGluYXRvciBhZ2VudCBpbnRlcm5hbGx5IG1hbmFnZXMgTUNQIHRvb2wgaW52b2NhdGlvbiB2aWEgTUNQVG9vbFJlZ2lzdHJ5XG4gICAgLy8gTUNQIHNlcnZlcnMgYXJlIHNwYXduZWQgYXMgY2hpbGQgcHJvY2Vzc2VzIGFuZCBjb21tdW5pY2F0ZSB2aWEgc3RkaW8gKEpTT04tUlBDIDIuMClcbiAgICBjb25zdCBzeW50aGVzaXplclRhc2sgPSB0aGlzLmNyZWF0ZUFnZW50VGFzayhcbiAgICAgICdTeW50aGVzaXplclRhc2snLFxuICAgICAgcHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMuc3ludGhlc2l6ZXIsXG4gICAgICBwcm9wc1xuICAgICk7XG5cbiAgICBjb25zdCBjcml0aWNUYXNrID0gdGhpcy5jcmVhdGVBZ2VudFRhc2soXG4gICAgICAnQ3JpdGljVGFzaycsXG4gICAgICBwcm9wcy5hZ2VudFRhc2tEZWZpbml0aW9ucy5jcml0aWMsXG4gICAgICBwcm9wc1xuICAgICk7XG5cbiAgICBjb25zdCBzeW50aGVzaXNDcnVjaWJsZSA9IG5ldyBzZm4uUGFyYWxsZWwodGhpcywgJ0xhdW5jaFN5bnRoZXNpc0NydWNpYmxlJywge1xuICAgICAgcmVzdWx0UGF0aDogJyQuc3ludGhlc2lzX3Jlc3VsdHMnLFxuICAgIH0pO1xuXG4gICAgc3ludGhlc2lzQ3J1Y2libGUuYnJhbmNoKHN5bnRoZXNpemVyVGFzayk7XG4gICAgc3ludGhlc2lzQ3J1Y2libGUuYnJhbmNoKGNyaXRpY1Rhc2spO1xuXG4gICAgLy8gNy4gV2FpdCBmb3IgTmVnb3RpYXRpb25cbiAgICBjb25zdCB3YWl0Rm9yQ29uc2Vuc3VzID0gbmV3IHNmbi5XYWl0KHRoaXMsICdXYWl0Rm9yQ29uc2Vuc3VzJywge1xuICAgICAgdGltZTogc2ZuLldhaXRUaW1lLmR1cmF0aW9uKGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSksXG4gICAgfSk7XG5cbiAgICAvLyA4LiBBcmNoaXZpc3QgVGFza1xuICAgIGNvbnN0IGFyY2hpdmlzdFRhc2sgPSB0aGlzLmNyZWF0ZUFnZW50VGFzayhcbiAgICAgICdBcmNoaXZpc3RUYXNrJyxcbiAgICAgIHByb3BzLmFnZW50VGFza0RlZmluaXRpb25zLmFyY2hpdmlzdCxcbiAgICAgIHByb3BzXG4gICAgKTtcblxuICAgIC8vIDkuIE5vdGlmeSBDb21wbGV0aW9uXG4gICAgY29uc3Qgbm90aWZ5Q29tcGxldGlvbiA9IG5ldyB0YXNrcy5TbnNQdWJsaXNoKHRoaXMsICdOb3RpZnlDb21wbGV0aW9uJywge1xuICAgICAgdG9waWM6IHRoaXMuY29tcGxldGlvblRvcGljLFxuICAgICAgbWVzc2FnZTogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgbWlzc2lvbl9pZDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLm1pc3Npb25faWQnKSxcbiAgICAgICAgc3RhdHVzOiAnQ09NUExFVEVEJyxcbiAgICAgICAgZmluZGluZ3NfY291bnQ6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5hcmNoaXZhbF9yZXN1bHQuY291bnQnKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgLy8gMTAuIEZhaWx1cmUgSGFuZGxlclxuICAgIGNvbnN0IGhhbmRsZUZhaWx1cmUgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdIYW5kbGVGYWlsdXJlJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHByb3BzLmZhaWx1cmVIYW5kbGVyTGFtYmRhLFxuICAgICAgcGF5bG9hZDogc2ZuLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgbWlzc2lvbl9pZDogc2ZuLkpzb25QYXRoLnN0cmluZ0F0KCckLm1pc3Npb25faWQnKSxcbiAgICAgICAgZXJyb3I6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5lcnJvcicpLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBjb25zdCBmYWlsdXJlRW5kID0gbmV3IHNmbi5TdWNjZWVkKHRoaXMsICdGYWlsdXJlUmVjb3JkZWQnKTtcblxuICAgIC8vIENoYWluIHRoZSBzdGF0ZXM6IHVucGFjayAtPiBzY2FuIHR5cGUgY2hvaWNlIC0+IChhd3MvY29kZSBwYXRocykgLT4gY29vcmRpbmF0b3IgLT4gc3ludGhlc2lzIC0+IGFyY2hpdmlzdFxuICAgIGNvbnN0IGRlZmluaXRpb24gPSB1bnBhY2tUYXNrXG4gICAgICAubmV4dChzY2FuVHlwZUNob2ljZSk7XG4gICAgXG4gICAgLy8gQWZ0ZXIgY29vcmRpbmF0b3IgKHdoaWNoIGludGVybmFsbHkgaGFuZGxlcyBNQ1AgdG9vbCBleGVjdXRpb24pLCBjb250aW51ZSB3aXRoIHN5bnRoZXNpc1xuICAgIGNvb3JkaW5hdG9yVGFza1xuICAgICAgLm5leHQoc3ludGhlc2lzQ3J1Y2libGUpXG4gICAgICAubmV4dCh3YWl0Rm9yQ29uc2Vuc3VzKVxuICAgICAgLm5leHQoYXJjaGl2aXN0VGFzaylcbiAgICAgIC5uZXh0KG5vdGlmeUNvbXBsZXRpb24pO1xuXG4gICAgLy8gQWRkIGVycm9yIGhhbmRsaW5nXG4gICAgdW5wYWNrVGFzay5hZGRDYXRjaChoYW5kbGVGYWlsdXJlLm5leHQoZmFpbHVyZUVuZCksIHtcbiAgICAgIGVycm9yczogWydTdGF0ZXMuQUxMJ10sXG4gICAgICByZXN1bHRQYXRoOiAnJC5lcnJvcicsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgU3RhdGUgTWFjaGluZVxuICAgIHRoaXMuc3RhdGVNYWNoaW5lID0gbmV3IHNmbi5TdGF0ZU1hY2hpbmUodGhpcywgJ0FnZW50aWNPcmNoZXN0cmF0b3InLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiAnSGl2ZW1pbmRBZ2VudGljT3JjaGVzdHJhdG9yJyxcbiAgICAgIGRlZmluaXRpb24sXG4gICAgICByb2xlOiBzdGVwRnVuY3Rpb25zUm9sZSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdTdGF0ZU1hY2hpbmVMb2dHcm91cCcsIHtcbiAgICAgICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL3N0ZXBmdW5jdGlvbnMvSGl2ZW1pbmRPcmNoZXN0cmF0b3InLFxuICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pLFxuICAgICAgICBsZXZlbDogc2ZuLkxvZ0xldmVsLkFMTCxcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IG5lY2Vzc2FyeSBwZXJtaXNzaW9ucyB0byBTdGVwIEZ1bmN0aW9ucyByb2xlXG4gICAgLy8gR3JhbnQgTGFtYmRhIGludm9rZSBwZXJtaXNzaW9ucyBoZXJlIGluIE9yY2hlc3RyYXRpb24gU3RhY2tcbiAgICAvLyBUaGlzIGlzIHNhZmUgYmVjYXVzZSBPcmNoZXN0cmF0aW9uIGFscmVhZHkgZGVwZW5kcyBvbiBDb21wdXRlXG4gICAgc3RlcEZ1bmN0aW9uc1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJ10sXG4gICAgICAgIHJlc291cmNlczogW3Byb3BzLnVucGFja0xhbWJkYS5mdW5jdGlvbkFybiwgcHJvcHMuZmFpbHVyZUhhbmRsZXJMYW1iZGEuZnVuY3Rpb25Bcm5dLFxuICAgICAgfSlcbiAgICApO1xuICAgIFxuICAgIHN0ZXBGdW5jdGlvbnNSb2xlLmFkZFRvUG9saWN5KFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ2VjczpSdW5UYXNrJywgJ2VjczpTdG9wVGFzaycsICdlY3M6RGVzY3JpYmVUYXNrcyddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgc3RlcEZ1bmN0aW9uc1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnaWFtOlBhc3NSb2xlJ10sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIC4uLk9iamVjdC52YWx1ZXMocHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMpLm1hcCgodGQpID0+IHRkLnRhc2tSb2xlLnJvbGVBcm4pLFxuICAgICAgICAgIC4uLk9iamVjdC52YWx1ZXMocHJvcHMuYWdlbnRUYXNrRGVmaW5pdGlvbnMpLm1hcCgodGQpID0+IHRkLmV4ZWN1dGlvblJvbGUhLnJvbGVBcm4pLFxuICAgICAgICAgIC8vIE1DUCB0b29scyBubyBsb25nZXIgcnVuIGFzIHNlcGFyYXRlIEVDUyB0YXNrc1xuICAgICAgICAgIC8vIFRoZXkgYXJlIG1hbmFnZWQgYXMgY2hpbGQgcHJvY2Vzc2VzIGJ5IHRoZSBDb29yZGluYXRvciBhZ2VudFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgc3RlcEZ1bmN0aW9uc1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnc25zOlB1Ymxpc2gnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5jb21wbGV0aW9uVG9waWMudG9waWNBcm5dLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgc3RlcEZ1bmN0aW9uc1JvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnZXZlbnRzOlB1dFRhcmdldHMnLCAnZXZlbnRzOlB1dFJ1bGUnLCAnZXZlbnRzOkRlc2NyaWJlUnVsZSddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gPT09PT09PT09PSBFVkVOVEJSSURHRSBSVUxFID09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBydWxlIHRvIHRyaWdnZXIgb24gUzMgdXBsb2Fkc1xuICAgIHRoaXMuZXZlbnRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdDb2RlVXBsb2FkVHJpZ2dlcicsIHtcbiAgICAgIHJ1bGVOYW1lOiAnSGl2ZW1pbmRDb2RlVXBsb2FkVHJpZ2dlcicsXG4gICAgICBkZXNjcmlwdGlvbjogJ1RyaWdnZXJzIFN0ZXAgRnVuY3Rpb25zIHdoZW4gY29kZSBpcyB1cGxvYWRlZCB0byBTMycsXG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ2F3cy5zMyddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ09iamVjdCBDcmVhdGVkJ10sXG4gICAgICAgIGRldGFpbDoge1xuICAgICAgICAgIGJ1Y2tldDoge1xuICAgICAgICAgICAgbmFtZTogW3Byb3BzLnVwbG9hZHNCdWNrZXQuYnVja2V0TmFtZV0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBvYmplY3Q6IHtcbiAgICAgICAgICAgIGtleTogW3sgcHJlZml4OiAndXBsb2Fkcy8nIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIFN0ZXAgRnVuY3Rpb25zIGFzIHRhcmdldFxuICAgIHRoaXMuZXZlbnRSdWxlLmFkZFRhcmdldChcbiAgICAgIG5ldyB0YXJnZXRzLlNmblN0YXRlTWFjaGluZSh0aGlzLnN0YXRlTWFjaGluZSwge1xuICAgICAgICBpbnB1dDogZXZlbnRzLlJ1bGVUYXJnZXRJbnB1dC5mcm9tRXZlbnRQYXRoKCckJyksXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09IENMT1VEV0FUQ0ggQUxBUk1TID09PT09PT09PT1cblxuICAgIC8vIEFsYXJtIGZvciBTdGVwIEZ1bmN0aW9ucyBleGVjdXRpb24gZmFpbHVyZXNcbiAgICBjb25zdCBleGVjdXRpb25GYWlsdXJlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnRXhlY3V0aW9uRmFpbHVyZUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnSGl2ZW1pbmQtU3RhdGVNYWNoaW5lLUZhaWx1cmVzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIFN0ZXAgRnVuY3Rpb25zIGV4ZWN1dGlvbiBmYWlscycsXG4gICAgICBtZXRyaWM6IHRoaXMuc3RhdGVNYWNoaW5lLm1ldHJpY0ZhaWxlZCh7XG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fT1JfRVFVQUxfVE9fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICBleGVjdXRpb25GYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5jb21wbGV0aW9uVG9waWMpKTtcblxuICAgIC8vIEFsYXJtIGZvciBsb25nLXJ1bm5pbmcgZXhlY3V0aW9ucyAoPiA0NSBtaW51dGVzKVxuICAgIGNvbnN0IGV4ZWN1dGlvbkR1cmF0aW9uTWV0cmljID0gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgIG5hbWVzcGFjZTogJ0FXUy9TdGF0ZXMnLFxuICAgICAgbWV0cmljTmFtZTogJ0V4ZWN1dGlvblRpbWUnLFxuICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICBTdGF0ZU1hY2hpbmVBcm46IHRoaXMuc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybixcbiAgICAgIH0sXG4gICAgICBzdGF0aXN0aWM6ICdNYXhpbXVtJyxcbiAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSk7XG5cbiAgICBjb25zdCBsb25nUnVubmluZ0FsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0xvbmdSdW5uaW5nRXhlY3V0aW9uQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdIaXZlbWluZC1TdGF0ZU1hY2hpbmUtTG9uZ1J1bm5pbmcnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsZXJ0IHdoZW4gU3RlcCBGdW5jdGlvbnMgZXhlY3V0aW9uIHJ1bnMgbG9uZ2VyIHRoYW4gNDUgbWludXRlcycsXG4gICAgICBtZXRyaWM6IGV4ZWN1dGlvbkR1cmF0aW9uTWV0cmljLFxuICAgICAgdGhyZXNob2xkOiA0NSAqIDYwICogMTAwMCwgLy8gNDUgbWludXRlcyBpbiBtaWxsaXNlY29uZHNcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICBsb25nUnVubmluZ0FsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKHRoaXMuY29tcGxldGlvblRvcGljKSk7XG5cbiAgICAvLyBBbGFybSBmb3IgTUNQIHRhc2sgZmFpbHVyZXMgKFNjb3V0U3VpdGUgYW5kIFBhY3UpXG4gICAgY29uc3QgbWNwRmFpbHVyZU1ldHJpYyA9IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICBuYW1lc3BhY2U6ICdBV1MvRUNTJyxcbiAgICAgIG1ldHJpY05hbWU6ICdUYXNrc0ZhaWxlZCcsXG4gICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgIENsdXN0ZXJOYW1lOiBwcm9wcy5lY3NDbHVzdGVyLmNsdXN0ZXJOYW1lLFxuICAgICAgfSxcbiAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbWNwVGFza0ZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdNQ1BUYXNrRmFpbHVyZUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnSGl2ZW1pbmQtTUNQLVRhc2stRmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsZXJ0IHdoZW4gTUNQIHRhc2tzIGZhaWwnLFxuICAgICAgbWV0cmljOiBtY3BGYWlsdXJlTWV0cmljLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIG1jcFRhc2tGYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24odGhpcy5jb21wbGV0aW9uVG9waWMpKTtcblxuICAgIC8vID09PT09PT09PT0gT1VUUFVUUyA9PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RhdGVNYWNoaW5lQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RlcCBGdW5jdGlvbnMgU3RhdGUgTWFjaGluZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogJ0hpdmVtaW5kUHJpc20tU3RhdGVNYWNoaW5lQXJuJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDb21wbGV0aW9uVG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jb21wbGV0aW9uVG9waWMudG9waWNBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NOUyBUb3BpYyBmb3IgY29tcGxldGlvbiBub3RpZmljYXRpb25zJyxcbiAgICAgIGV4cG9ydE5hbWU6ICdIaXZlbWluZFByaXNtLUNvbXBsZXRpb25Ub3BpY0FybicsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUFnZW50VGFzayhcbiAgICBpZDogc3RyaW5nLFxuICAgIHRhc2tEZWZpbml0aW9uOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uLFxuICAgIHByb3BzOiBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wc1xuICApOiB0YXNrcy5FY3NSdW5UYXNrIHtcbiAgICByZXR1cm4gbmV3IHRhc2tzLkVjc1J1blRhc2sodGhpcywgaWQsIHtcbiAgICAgIGludGVncmF0aW9uUGF0dGVybjogc2ZuLkludGVncmF0aW9uUGF0dGVybi5SVU5fSk9CLFxuICAgICAgY2x1c3RlcjogcHJvcHMuZWNzQ2x1c3RlcixcbiAgICAgIHRhc2tEZWZpbml0aW9uLFxuICAgICAgbGF1bmNoVGFyZ2V0OiBuZXcgdGFza3MuRWNzRmFyZ2F0ZUxhdW5jaFRhcmdldCh7XG4gICAgICAgIHBsYXRmb3JtVmVyc2lvbjogZWNzLkZhcmdhdGVQbGF0Zm9ybVZlcnNpb24uTEFURVNULFxuICAgICAgfSksXG4gICAgICBjb250YWluZXJPdmVycmlkZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGNvbnRhaW5lckRlZmluaXRpb246IHRhc2tEZWZpbml0aW9uLmRlZmF1bHRDb250YWluZXIhLFxuICAgICAgICAgIGVudmlyb25tZW50OiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6ICdNSVNTSU9OX0lEJyxcbiAgICAgICAgICAgICAgdmFsdWU6IHNmbi5Kc29uUGF0aC5zdHJpbmdBdCgnJC5taXNzaW9uX2lkJyksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtwcm9wcy5hZ2VudFNlY3VyaXR5R3JvdXBdLFxuICAgICAgc3VibmV0czogeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEIH0sXG4gICAgICByZXN1bHRQYXRoOiBgJC4ke2lkLnRvTG93ZXJDYXNlKCl9X3Jlc3VsdGAsXG4gICAgfSk7XG4gIH1cblxuICAvLyBNQ1Agc2VydmVycyBhcmUgbm8gbG9uZ2VyIHJ1biBhcyBzZXBhcmF0ZSBFQ1MgdGFza3NcbiAgLy8gVGhleSBhcmUgc3Bhd25lZCBhcyBjaGlsZCBwcm9jZXNzZXMgYnkgdGhlIENvb3JkaW5hdG9yIGFnZW50XG4gIC8vIGFuZCBjb21tdW5pY2F0ZSB2aWEgc3RkaW8gdXNpbmcgSlNPTi1SUEMgMi4wIHByb3RvY29sXG59Il19