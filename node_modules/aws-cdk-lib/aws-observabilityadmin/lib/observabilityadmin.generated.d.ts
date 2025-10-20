import * as cdk from "../../core";
import * as constructs from "constructs";
import * as cfn_parse from "../../core/lib/helpers-internal";
/**
 * Indicates that this resource can be referenced as a OrganizationCentralizationRule.
 *
 * @stability experimental
 */
export interface IOrganizationCentralizationRuleRef extends constructs.IConstruct {
    /**
     * A reference to a OrganizationCentralizationRule resource.
     */
    readonly organizationCentralizationRuleRef: OrganizationCentralizationRuleReference;
}
/**
 * Resource schema for AWS:ObservabilityAdmin:OrganizationCentralizationRule.
 *
 * @cloudformationResource AWS::ObservabilityAdmin::OrganizationCentralizationRule
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationcentralizationrule.html
 */
export declare class CfnOrganizationCentralizationRule extends cdk.CfnResource implements cdk.IInspectable, IOrganizationCentralizationRuleRef, cdk.ITaggableV2 {
    /**
     * The CloudFormation resource type name for this resource class.
     */
    static readonly CFN_RESOURCE_TYPE_NAME: string;
    /**
     * Build a CfnOrganizationCentralizationRule from CloudFormation properties
     *
     * A factory method that creates a new instance of this class from an object
     * containing the CloudFormation properties of this resource.
     * Used in the @aws-cdk/cloudformation-include module.
     *
     * @internal
     */
    static _fromCloudFormation(scope: constructs.Construct, id: string, resourceAttributes: any, options: cfn_parse.FromCloudFormationOptions): CfnOrganizationCentralizationRule;
    /**
     * @cloudformationAttribute RuleArn
     */
    readonly attrRuleArn: string;
    /**
     * Tag Manager which manages the tags for this resource
     */
    readonly cdkTagManager: cdk.TagManager;
    rule: CfnOrganizationCentralizationRule.CentralizationRuleProperty | cdk.IResolvable;
    ruleName: string;
    /**
     * An array of key-value pairs to apply to this resource.
     */
    tags?: Array<cdk.CfnTag>;
    /**
     * @param scope Scope in which this resource is defined
     * @param id Construct identifier for this resource (unique in its scope)
     * @param props Resource properties
     */
    constructor(scope: constructs.Construct, id: string, props: CfnOrganizationCentralizationRuleProps);
    get organizationCentralizationRuleRef(): OrganizationCentralizationRuleReference;
    protected get cfnProperties(): Record<string, any>;
    /**
     * Examines the CloudFormation resource and discloses attributes
     *
     * @param inspector tree inspector to collect and process attributes
     */
    inspect(inspector: cdk.TreeInspector): void;
    protected renderProperties(props: Record<string, any>): Record<string, any>;
}
export declare namespace CfnOrganizationCentralizationRule {
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrule.html
     */
    interface CentralizationRuleProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrule.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationrule-destination
         */
        readonly destination: CfnOrganizationCentralizationRule.CentralizationRuleDestinationProperty | cdk.IResolvable;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrule.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationrule-source
         */
        readonly source: CfnOrganizationCentralizationRule.CentralizationRuleSourceProperty | cdk.IResolvable;
    }
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrulesource.html
     */
    interface CentralizationRuleSourceProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrulesource.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationrulesource-regions
         */
        readonly regions: Array<string>;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrulesource.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationrulesource-scope
         */
        readonly scope?: string;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationrulesource.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationrulesource-sourcelogsconfiguration
         */
        readonly sourceLogsConfiguration?: cdk.IResolvable | CfnOrganizationCentralizationRule.SourceLogsConfigurationProperty;
    }
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-sourcelogsconfiguration.html
     */
    interface SourceLogsConfigurationProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-sourcelogsconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-sourcelogsconfiguration-encryptedloggroupstrategy
         */
        readonly encryptedLogGroupStrategy: string;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-sourcelogsconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-sourcelogsconfiguration-loggroupselectioncriteria
         */
        readonly logGroupSelectionCriteria: string;
    }
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationruledestination.html
     */
    interface CentralizationRuleDestinationProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationruledestination.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationruledestination-account
         */
        readonly account?: string;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationruledestination.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationruledestination-destinationlogsconfiguration
         */
        readonly destinationLogsConfiguration?: CfnOrganizationCentralizationRule.DestinationLogsConfigurationProperty | cdk.IResolvable;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-centralizationruledestination.html#cfn-observabilityadmin-organizationcentralizationrule-centralizationruledestination-region
         */
        readonly region: string;
    }
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-destinationlogsconfiguration.html
     */
    interface DestinationLogsConfigurationProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-destinationlogsconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-destinationlogsconfiguration-backupconfiguration
         */
        readonly backupConfiguration?: cdk.IResolvable | CfnOrganizationCentralizationRule.LogsBackupConfigurationProperty;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-destinationlogsconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-destinationlogsconfiguration-logsencryptionconfiguration
         */
        readonly logsEncryptionConfiguration?: cdk.IResolvable | CfnOrganizationCentralizationRule.LogsEncryptionConfigurationProperty;
    }
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration.html
     */
    interface LogsEncryptionConfigurationProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration-encryptionconflictresolutionstrategy
         */
        readonly encryptionConflictResolutionStrategy?: string;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration-encryptionstrategy
         */
        readonly encryptionStrategy: string;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-logsencryptionconfiguration-kmskeyarn
         */
        readonly kmsKeyArn?: string;
    }
    /**
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsbackupconfiguration.html
     */
    interface LogsBackupConfigurationProperty {
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsbackupconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-logsbackupconfiguration-kmskeyarn
         */
        readonly kmsKeyArn?: string;
        /**
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationcentralizationrule-logsbackupconfiguration.html#cfn-observabilityadmin-organizationcentralizationrule-logsbackupconfiguration-region
         */
        readonly region: string;
    }
}
/**
 * Properties for defining a `CfnOrganizationCentralizationRule`
 *
 * @struct
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationcentralizationrule.html
 */
export interface CfnOrganizationCentralizationRuleProps {
    /**
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationcentralizationrule.html#cfn-observabilityadmin-organizationcentralizationrule-rule
     */
    readonly rule: CfnOrganizationCentralizationRule.CentralizationRuleProperty | cdk.IResolvable;
    /**
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationcentralizationrule.html#cfn-observabilityadmin-organizationcentralizationrule-rulename
     */
    readonly ruleName: string;
    /**
     * An array of key-value pairs to apply to this resource.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationcentralizationrule.html#cfn-observabilityadmin-organizationcentralizationrule-tags
     */
    readonly tags?: Array<cdk.CfnTag>;
}
/**
 * A reference to a OrganizationCentralizationRule resource.
 *
 * @struct
 * @stability external
 */
export interface OrganizationCentralizationRuleReference {
    /**
     * The RuleArn of the OrganizationCentralizationRule resource.
     */
    readonly ruleArn: string;
}
/**
 * Indicates that this resource can be referenced as a OrganizationTelemetryRule.
 *
 * @stability experimental
 */
export interface IOrganizationTelemetryRuleRef extends constructs.IConstruct {
    /**
     * A reference to a OrganizationTelemetryRule resource.
     */
    readonly organizationTelemetryRuleRef: OrganizationTelemetryRuleReference;
}
/**
 * The AWS::ObservabilityAdmin::OrganizationTelemetryRule resource defines a CloudWatch Observability Admin Organization Telemetry Rule.
 *
 * @cloudformationResource AWS::ObservabilityAdmin::OrganizationTelemetryRule
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationtelemetryrule.html
 */
export declare class CfnOrganizationTelemetryRule extends cdk.CfnResource implements cdk.IInspectable, IOrganizationTelemetryRuleRef, cdk.ITaggableV2 {
    /**
     * The CloudFormation resource type name for this resource class.
     */
    static readonly CFN_RESOURCE_TYPE_NAME: string;
    /**
     * Build a CfnOrganizationTelemetryRule from CloudFormation properties
     *
     * A factory method that creates a new instance of this class from an object
     * containing the CloudFormation properties of this resource.
     * Used in the @aws-cdk/cloudformation-include module.
     *
     * @internal
     */
    static _fromCloudFormation(scope: constructs.Construct, id: string, resourceAttributes: any, options: cfn_parse.FromCloudFormationOptions): CfnOrganizationTelemetryRule;
    /**
     * The arn of the organization telemetry rule
     *
     * @cloudformationAttribute RuleArn
     */
    readonly attrRuleArn: string;
    /**
     * Tag Manager which manages the tags for this resource
     */
    readonly cdkTagManager: cdk.TagManager;
    /**
     * The telemetry rule.
     */
    rule: cdk.IResolvable | CfnOrganizationTelemetryRule.TelemetryRuleProperty;
    /**
     * The name of the organization telemetry rule.
     */
    ruleName: string;
    /**
     * An array of key-value pairs to apply to this resource.
     */
    tags?: Array<cdk.CfnTag>;
    /**
     * @param scope Scope in which this resource is defined
     * @param id Construct identifier for this resource (unique in its scope)
     * @param props Resource properties
     */
    constructor(scope: constructs.Construct, id: string, props: CfnOrganizationTelemetryRuleProps);
    get organizationTelemetryRuleRef(): OrganizationTelemetryRuleReference;
    protected get cfnProperties(): Record<string, any>;
    /**
     * Examines the CloudFormation resource and discloses attributes
     *
     * @param inspector tree inspector to collect and process attributes
     */
    inspect(inspector: cdk.TreeInspector): void;
    protected renderProperties(props: Record<string, any>): Record<string, any>;
}
export declare namespace CfnOrganizationTelemetryRule {
    /**
     * The telemetry rule.
     *
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetryrule.html
     */
    interface TelemetryRuleProperty {
        /**
         * The destination configuration for telemetry data.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-telemetryrule-destinationconfiguration
         */
        readonly destinationConfiguration?: cdk.IResolvable | CfnOrganizationTelemetryRule.TelemetryDestinationConfigurationProperty;
        /**
         * Resource Type associated with the Organization Telemetry Rule.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-telemetryrule-resourcetype
         */
        readonly resourceType: string;
        /**
         * Selection Criteria on scope level for rule application.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-telemetryrule-scope
         */
        readonly scope?: string;
        /**
         * Selection Criteria on resource level for rule application.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-telemetryrule-selectioncriteria
         */
        readonly selectionCriteria?: string;
        /**
         * Telemetry Type associated with the Organization Telemetry Rule.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-telemetryrule-telemetrytype
         */
        readonly telemetryType: string;
    }
    /**
     * The destination configuration for telemetry data.
     *
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration.html
     */
    interface TelemetryDestinationConfigurationProperty {
        /**
         * Pattern for telemetry data destination.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration-destinationpattern
         */
        readonly destinationPattern?: string;
        /**
         * Type of telemetry destination.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration-destinationtype
         */
        readonly destinationType?: string;
        /**
         * Number of days to retain the telemetry data in the specified destination.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration-retentionindays
         */
        readonly retentionInDays?: number;
        /**
         * Telemetry parameters for VPC Flow logs.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-organizationtelemetryrule-telemetrydestinationconfiguration-vpcflowlogparameters
         */
        readonly vpcFlowLogParameters?: cdk.IResolvable | CfnOrganizationTelemetryRule.VPCFlowLogParametersProperty;
    }
    /**
     * Telemetry parameters for VPC Flow logs.
     *
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters.html
     */
    interface VPCFlowLogParametersProperty {
        /**
         * The fields to include in the flow log record.
         *
         * If you omit this parameter, the flow log is created using the default format.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters.html#cfn-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters-logformat
         */
        readonly logFormat?: string;
        /**
         * The maximum interval of time, in seconds, during which a flow of packets is captured and aggregated into a flow log record.
         *
         * Default is 600s.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters.html#cfn-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters-maxaggregationinterval
         */
        readonly maxAggregationInterval?: number;
        /**
         * The type of traffic captured for the flow log.
         *
         * Default is ALL
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters.html#cfn-observabilityadmin-organizationtelemetryrule-vpcflowlogparameters-traffictype
         */
        readonly trafficType?: string;
    }
}
/**
 * Properties for defining a `CfnOrganizationTelemetryRule`
 *
 * @struct
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationtelemetryrule.html
 */
export interface CfnOrganizationTelemetryRuleProps {
    /**
     * The telemetry rule.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationtelemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-rule
     */
    readonly rule: cdk.IResolvable | CfnOrganizationTelemetryRule.TelemetryRuleProperty;
    /**
     * The name of the organization telemetry rule.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationtelemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-rulename
     */
    readonly ruleName: string;
    /**
     * An array of key-value pairs to apply to this resource.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-organizationtelemetryrule.html#cfn-observabilityadmin-organizationtelemetryrule-tags
     */
    readonly tags?: Array<cdk.CfnTag>;
}
/**
 * A reference to a OrganizationTelemetryRule resource.
 *
 * @struct
 * @stability external
 */
export interface OrganizationTelemetryRuleReference {
    /**
     * The RuleArn of the OrganizationTelemetryRule resource.
     */
    readonly ruleArn: string;
}
/**
 * Indicates that this resource can be referenced as a TelemetryRule.
 *
 * @stability experimental
 */
export interface ITelemetryRuleRef extends constructs.IConstruct {
    /**
     * A reference to a TelemetryRule resource.
     */
    readonly telemetryRuleRef: TelemetryRuleReference;
}
/**
 * The AWS::ObservabilityAdmin::TelemetryRule resource defines a CloudWatch Observability Admin Telemetry Rule.
 *
 * @cloudformationResource AWS::ObservabilityAdmin::TelemetryRule
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-telemetryrule.html
 */
export declare class CfnTelemetryRule extends cdk.CfnResource implements cdk.IInspectable, ITelemetryRuleRef, cdk.ITaggableV2 {
    /**
     * The CloudFormation resource type name for this resource class.
     */
    static readonly CFN_RESOURCE_TYPE_NAME: string;
    /**
     * Build a CfnTelemetryRule from CloudFormation properties
     *
     * A factory method that creates a new instance of this class from an object
     * containing the CloudFormation properties of this resource.
     * Used in the @aws-cdk/cloudformation-include module.
     *
     * @internal
     */
    static _fromCloudFormation(scope: constructs.Construct, id: string, resourceAttributes: any, options: cfn_parse.FromCloudFormationOptions): CfnTelemetryRule;
    /**
     * The arn of the telemetry rule
     *
     * @cloudformationAttribute RuleArn
     */
    readonly attrRuleArn: string;
    /**
     * Tag Manager which manages the tags for this resource
     */
    readonly cdkTagManager: cdk.TagManager;
    /**
     * The telemetry rule.
     */
    rule: cdk.IResolvable | CfnTelemetryRule.TelemetryRuleProperty;
    /**
     * The name of the telemetry rule.
     */
    ruleName: string;
    /**
     * An array of key-value pairs to apply to this resource.
     */
    tags?: Array<cdk.CfnTag>;
    /**
     * @param scope Scope in which this resource is defined
     * @param id Construct identifier for this resource (unique in its scope)
     * @param props Resource properties
     */
    constructor(scope: constructs.Construct, id: string, props: CfnTelemetryRuleProps);
    get telemetryRuleRef(): TelemetryRuleReference;
    protected get cfnProperties(): Record<string, any>;
    /**
     * Examines the CloudFormation resource and discloses attributes
     *
     * @param inspector tree inspector to collect and process attributes
     */
    inspect(inspector: cdk.TreeInspector): void;
    protected renderProperties(props: Record<string, any>): Record<string, any>;
}
export declare namespace CfnTelemetryRule {
    /**
     * The telemetry rule.
     *
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetryrule.html
     */
    interface TelemetryRuleProperty {
        /**
         * The destination configuration for telemetry data.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetryrule.html#cfn-observabilityadmin-telemetryrule-telemetryrule-destinationconfiguration
         */
        readonly destinationConfiguration?: cdk.IResolvable | CfnTelemetryRule.TelemetryDestinationConfigurationProperty;
        /**
         * Resource Type associated with the Telemetry Rule.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetryrule.html#cfn-observabilityadmin-telemetryrule-telemetryrule-resourcetype
         */
        readonly resourceType: string;
        /**
         * Selection Criteria on resource level for rule application.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetryrule.html#cfn-observabilityadmin-telemetryrule-telemetryrule-selectioncriteria
         */
        readonly selectionCriteria?: string;
        /**
         * Telemetry Type associated with the Telemetry Rule.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetryrule.html#cfn-observabilityadmin-telemetryrule-telemetryrule-telemetrytype
         */
        readonly telemetryType: string;
    }
    /**
     * The destination configuration for telemetry data.
     *
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetrydestinationconfiguration.html
     */
    interface TelemetryDestinationConfigurationProperty {
        /**
         * Pattern for telemetry data destination.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-telemetryrule-telemetrydestinationconfiguration-destinationpattern
         */
        readonly destinationPattern?: string;
        /**
         * Type of telemetry destination.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-telemetryrule-telemetrydestinationconfiguration-destinationtype
         */
        readonly destinationType?: string;
        /**
         * Number of days to retain the telemetry data in the specified destination.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-telemetryrule-telemetrydestinationconfiguration-retentionindays
         */
        readonly retentionInDays?: number;
        /**
         * Telemetry parameters for VPC Flow logs.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-telemetrydestinationconfiguration.html#cfn-observabilityadmin-telemetryrule-telemetrydestinationconfiguration-vpcflowlogparameters
         */
        readonly vpcFlowLogParameters?: cdk.IResolvable | CfnTelemetryRule.VPCFlowLogParametersProperty;
    }
    /**
     * Telemetry parameters for VPC Flow logs.
     *
     * @struct
     * @stability external
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-vpcflowlogparameters.html
     */
    interface VPCFlowLogParametersProperty {
        /**
         * The fields to include in the flow log record.
         *
         * If you omit this parameter, the flow log is created using the default format.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-vpcflowlogparameters.html#cfn-observabilityadmin-telemetryrule-vpcflowlogparameters-logformat
         */
        readonly logFormat?: string;
        /**
         * The maximum interval of time, in seconds, during which a flow of packets is captured and aggregated into a flow log record.
         *
         * Default is 600s.
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-vpcflowlogparameters.html#cfn-observabilityadmin-telemetryrule-vpcflowlogparameters-maxaggregationinterval
         */
        readonly maxAggregationInterval?: number;
        /**
         * The type of traffic captured for the flow log.
         *
         * Default is ALL
         *
         * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-observabilityadmin-telemetryrule-vpcflowlogparameters.html#cfn-observabilityadmin-telemetryrule-vpcflowlogparameters-traffictype
         */
        readonly trafficType?: string;
    }
}
/**
 * Properties for defining a `CfnTelemetryRule`
 *
 * @struct
 * @stability external
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-telemetryrule.html
 */
export interface CfnTelemetryRuleProps {
    /**
     * The telemetry rule.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-telemetryrule.html#cfn-observabilityadmin-telemetryrule-rule
     */
    readonly rule: cdk.IResolvable | CfnTelemetryRule.TelemetryRuleProperty;
    /**
     * The name of the telemetry rule.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-telemetryrule.html#cfn-observabilityadmin-telemetryrule-rulename
     */
    readonly ruleName: string;
    /**
     * An array of key-value pairs to apply to this resource.
     *
     * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-observabilityadmin-telemetryrule.html#cfn-observabilityadmin-telemetryrule-tags
     */
    readonly tags?: Array<cdk.CfnTag>;
}
/**
 * A reference to a TelemetryRule resource.
 *
 * @struct
 * @stability external
 */
export interface TelemetryRuleReference {
    /**
     * The RuleArn of the TelemetryRule resource.
     */
    readonly ruleArn: string;
}
