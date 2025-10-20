import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface OrchestrationStackProps extends cdk.StackProps {
  uploadsBucket: s3.Bucket;
  missionStatusTable: dynamodb.Table;
  agentTaskDefinitions: { [key: string]: ecs.FargateTaskDefinition };
  mcpTaskDefinitions: { [key: string]: ecs.FargateTaskDefinition };
  unpackLambda: lambda.Function;
  ecsCluster: ecs.Cluster;
  vpc: ec2.Vpc;
  agentSecurityGroup: ec2.SecurityGroup;
  mcpToolsSecurityGroup: ec2.SecurityGroup;
}

export class OrchestrationStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly eventRule: events.Rule;
  public readonly completionTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
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
    const coordinatorTask = this.createAgentTask(
      'CoordinatorDecision',
      props.agentTaskDefinitions.coordinator,
      props
    );

    // 3a. AWS Scan Path - Just Strategist (skip Archaeologist)
    const strategistTaskAWS = this.createAgentTask(
      'StrategistTaskAWS',
      props.agentTaskDefinitions.strategist,
      props
    );
    strategistTaskAWS.next(coordinatorTask);

    // 3b. Code Scan Path - Deploy Context Agents (Parallel)
    const archaeologistTask = this.createAgentTask(
      'ArchaeologistTask',
      props.agentTaskDefinitions.archaeologist,
      props
    );

    const strategistTask = this.createAgentTask(
      'StrategistTask',
      props.agentTaskDefinitions.strategist,
      props
    );

    const contextAgentsParallel = new sfn.Parallel(this, 'DeployContextAgents', {
      resultPath: '$.context_results',
    });

    contextAgentsParallel.branch(archaeologistTask);
    contextAgentsParallel.branch(strategistTask);
    contextAgentsParallel.next(coordinatorTask);

    // 3c. Scan Type Decision - Branch to appropriate path
    const scanTypeChoice = new sfn.Choice(this, 'ScanTypeDecision')
      .when(
        sfn.Condition.stringEquals('$.scan_type', 'aws'),
        strategistTaskAWS
      )
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
          containerDefinition: props.mcpTaskDefinitions['semgrep-mcp'].defaultContainer!,
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
    const synthesizerTask = this.createAgentTask(
      'SynthesizerTask',
      props.agentTaskDefinitions.synthesizer,
      props
    );

    const criticTask = this.createAgentTask(
      'CriticTask',
      props.agentTaskDefinitions.critic,
      props
    );

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
    const archivistTask = this.createAgentTask(
      'ArchivistTask',
      props.agentTaskDefinitions.archivist,
      props
    );

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
    stepFunctionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [props.unpackLambda.functionArn],
      })
    );
    
    stepFunctionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask', 'ecs:StopTask', 'ecs:DescribeTasks'],
        resources: ['*'],
      })
    );

    stepFunctionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          ...Object.values(props.agentTaskDefinitions).map((td) => td.taskRole.roleArn),
          ...Object.values(props.agentTaskDefinitions).map((td) => td.executionRole!.roleArn),
          ...Object.values(props.mcpTaskDefinitions).map((td) => td.taskRole.roleArn),
          ...Object.values(props.mcpTaskDefinitions).map((td) => td.executionRole!.roleArn),
        ],
      })
    );

    stepFunctionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [this.completionTopic.topicArn],
      })
    );

    stepFunctionsRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
        resources: ['*'],
      })
    );

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
    this.eventRule.addTarget(
      new targets.SfnStateMachine(this.stateMachine, {
        input: events.RuleTargetInput.fromEventPath('$'),
      })
    );

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

  private createAgentTask(
    id: string,
    taskDefinition: ecs.FargateTaskDefinition,
    props: OrchestrationStackProps
  ): tasks.EcsRunTask {
    return new tasks.EcsRunTask(this, id, {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster: props.ecsCluster,
      taskDefinition,
      launchTarget: new tasks.EcsFargateLaunchTarget({
        platformVersion: ecs.FargatePlatformVersion.LATEST,
      }),
      containerOverrides: [
        {
          containerDefinition: taskDefinition.defaultContainer!,
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