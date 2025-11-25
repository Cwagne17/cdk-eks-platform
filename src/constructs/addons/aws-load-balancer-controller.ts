import { Cluster, HelmChart } from "@aws-cdk/aws-eks-v2-alpha";
import { Duration, Names, Stack } from "aws-cdk-lib";
import { Effect, IRole, ManagedPolicy, PolicyDocument, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

const NAME = "aws-load-balancer-controller";

export interface AwsLoadBalancerControllerOptions {
    /**
     * Version of the controller.
     */
    readonly version: string;
}

export interface AwsLoadBalancerControllerProps extends AwsLoadBalancerControllerOptions {
    /**
     * Cluster to install the addon onto.
     */
    readonly cluster: Cluster;
}

export class AwsLoadBalancerControllerAddOn extends Construct {
    public readonly policy: ManagedPolicy;

    /**
     * Create the controller construct associated with this cluster and scope.
     *
     * Singleton per stack/cluster.
     */
    public static create(scope: Construct, props: AwsLoadBalancerControllerProps) {
        const stack = Stack.of(scope);
        const uid = AwsLoadBalancerControllerAddOn.uid(props.cluster);
        return new AwsLoadBalancerControllerAddOn(stack, uid, props);
    }

    private static uid(cluster: Cluster) {
        return `${Names.nodeUniqueId(cluster.node)}-AlbController`;
    }

    public constructor(scope: Construct, id: string, props: AwsLoadBalancerControllerProps) {
        super(scope, id);

        const namespace = 'kube-system';
        const helmChartVersion = props.version;

        // Create the managed policy that will be attached to node group roles
        this.policy = AwsLoadBalancerControllerIamPolicy(this);

        const chart = new HelmChart(this, 'Resource', {
            cluster: props.cluster,
            chart: NAME,
            repository: 'https://aws.github.io/eks-charts',
            namespace,
            release: NAME,
            version: helmChartVersion,

            wait: true,
            timeout: Duration.minutes(15),
            values: {
                clusterName: props.cluster.clusterName,
                region: Stack.of(this).region,
                vpcId: props.cluster.vpc.vpcId,
            },
        });

        // the controller relies on permissions deployed using the policy
        chart.node.addDependency(this.policy);
    }

    grantToRole(role: IRole) {
        role.addManagedPolicy(this.policy);
    }
}

export const AwsLoadBalancerControllerIamPolicy = (scope: Construct,) => {
    const partition = Stack.of(scope).partition

    return new ManagedPolicy(scope, 'AWSLoadBalancerControllerIAMPolicy', {
        description: 'IAM policy for AWS Load Balancer Controller on EKS worker nodes',
        document: new PolicyDocument({
            statements: [
                new PolicyStatement({
                    sid: 'CreateServiceLinkedRole',
                    effect: Effect.ALLOW,
                    actions: ['iam:CreateServiceLinkedRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:AWSServiceName': 'elasticloadbalancing.amazonaws.com',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'DescribeResources',
                    effect: Effect.ALLOW,
                    actions: [
                        'ec2:DescribeAccountAttributes',
                        'ec2:DescribeAddresses',
                        'ec2:DescribeAvailabilityZones',
                        'ec2:DescribeInternetGateways',
                        'ec2:DescribeVpcs',
                        'ec2:DescribeVpcPeeringConnections',
                        'ec2:DescribeSubnets',
                        'ec2:DescribeSecurityGroups',
                        'ec2:DescribeInstances',
                        'ec2:DescribeNetworkInterfaces',
                        'ec2:DescribeTags',
                        'ec2:GetCoipPoolUsage',
                        'ec2:DescribeCoipPools',
                        'ec2:GetSecurityGroupsForVpc',
                        'ec2:DescribeIpamPools',
                        'ec2:DescribeRouteTables',
                        'elasticloadbalancing:DescribeLoadBalancers',
                        'elasticloadbalancing:DescribeLoadBalancerAttributes',
                        'elasticloadbalancing:DescribeListeners',
                        'elasticloadbalancing:DescribeListenerCertificates',
                        'elasticloadbalancing:DescribeSSLPolicies',
                        'elasticloadbalancing:DescribeRules',
                        'elasticloadbalancing:DescribeTargetGroups',
                        'elasticloadbalancing:DescribeTargetGroupAttributes',
                        'elasticloadbalancing:DescribeTargetHealth',
                        'elasticloadbalancing:DescribeTags',
                        'elasticloadbalancing:DescribeTrustStores',
                        'elasticloadbalancing:DescribeListenerAttributes',
                        'elasticloadbalancing:DescribeCapacityReservation',
                    ],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    sid: 'AdditionalResourceAccess',
                    effect: Effect.ALLOW,
                    actions: [
                        'cognito-idp:DescribeUserPoolClient',
                        'acm:ListCertificates',
                        'acm:DescribeCertificate',
                        'iam:ListServerCertificates',
                        'iam:GetServerCertificate',
                        'waf-regional:GetWebACL',
                        'waf-regional:GetWebACLForResource',
                        'waf-regional:AssociateWebACL',
                        'waf-regional:DisassociateWebACL',
                        'wafv2:GetWebACL',
                        'wafv2:GetWebACLForResource',
                        'wafv2:AssociateWebACL',
                        'wafv2:DisassociateWebACL',
                        'shield:GetSubscriptionState',
                        'shield:DescribeProtection',
                        'shield:CreateProtection',
                        'shield:DeleteProtection',
                    ],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    sid: 'ManageSecurityGroups',
                    effect: Effect.ALLOW,
                    actions: [
                        'ec2:AuthorizeSecurityGroupIngress',
                        'ec2:RevokeSecurityGroupIngress',
                        'ec2:CreateSecurityGroup',
                    ],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    sid: 'CreateSecurityGroupTags',
                    effect: Effect.ALLOW,
                    actions: ['ec2:CreateTags'],
                    resources: [`arn:${partition}:ec2:*:*:security-group/*`],
                    conditions: {
                        StringEquals: {
                            'ec2:CreateAction': 'CreateSecurityGroup',
                        },
                        Null: {
                            'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'ManageSecurityGroupTags',
                    effect: Effect.ALLOW,
                    actions: ['ec2:CreateTags', 'ec2:DeleteTags'],
                    resources: [`arn:${partition}:ec2:*:*:security-group/*`],
                    conditions: {
                        Null: {
                            'aws:RequestTag/elbv2.k8s.aws/cluster': 'true',
                            'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'ManageClusterSecurityGroups',
                    effect: Effect.ALLOW,
                    actions: [
                        'ec2:AuthorizeSecurityGroupIngress',
                        'ec2:RevokeSecurityGroupIngress',
                        'ec2:DeleteSecurityGroup',
                    ],
                    resources: ['*'],
                    conditions: {
                        Null: {
                            'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'CreateLoadBalancers',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:CreateLoadBalancer',
                        'elasticloadbalancing:CreateTargetGroup',
                    ],
                    resources: ['*'],
                    conditions: {
                        Null: {
                            'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'ManageListeners',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:CreateListener',
                        'elasticloadbalancing:DeleteListener',
                        'elasticloadbalancing:CreateRule',
                        'elasticloadbalancing:DeleteRule',
                    ],
                    resources: ['*'],
                }),
                new PolicyStatement({
                    sid: 'ManageLoadBalancerTags',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:AddTags',
                        'elasticloadbalancing:RemoveTags',
                    ],
                    resources: [
                        `arn:${partition}:elasticloadbalancing:*:*:targetgroup/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:loadbalancer/net/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:loadbalancer/app/*/*`,
                    ],
                    conditions: {
                        Null: {
                            'aws:RequestTag/elbv2.k8s.aws/cluster': 'true',
                            'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'ManageListenerTags',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:AddTags',
                        'elasticloadbalancing:RemoveTags',
                    ],
                    resources: [
                        `arn:${partition}:elasticloadbalancing:*:*:listener/net/*/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:listener/app/*/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:listener-rule/net/*/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:listener-rule/app/*/*/*`,
                    ],
                }),
                new PolicyStatement({
                    sid: 'ModifyLoadBalancers',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:ModifyLoadBalancerAttributes',
                        'elasticloadbalancing:SetIpAddressType',
                        'elasticloadbalancing:SetSecurityGroups',
                        'elasticloadbalancing:SetSubnets',
                        'elasticloadbalancing:DeleteLoadBalancer',
                        'elasticloadbalancing:ModifyTargetGroup',
                        'elasticloadbalancing:ModifyTargetGroupAttributes',
                        'elasticloadbalancing:DeleteTargetGroup',
                        'elasticloadbalancing:ModifyListenerAttributes',
                        'elasticloadbalancing:ModifyCapacityReservation',
                        'elasticloadbalancing:ModifyIpPools',
                    ],
                    resources: ['*'],
                    conditions: {
                        Null: {
                            'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'TagNewResources',
                    effect: Effect.ALLOW,
                    actions: ['elasticloadbalancing:AddTags'],
                    resources: [
                        `arn:${partition}:elasticloadbalancing:*:*:targetgroup/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:loadbalancer/net/*/*`,
                        `arn:${partition}:elasticloadbalancing:*:*:loadbalancer/app/*/*`,
                    ],
                    conditions: {
                        StringEquals: {
                            'elasticloadbalancing:CreateAction': [
                                'CreateTargetGroup',
                                'CreateLoadBalancer',
                            ],
                        },
                        Null: {
                            'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
                        },
                    },
                }),
                new PolicyStatement({
                    sid: 'ManageTargets',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:RegisterTargets',
                        'elasticloadbalancing:DeregisterTargets',
                    ],
                    resources: [`arn:${partition}:elasticloadbalancing:*:*:targetgroup/*/*`],
                }),
                new PolicyStatement({
                    sid: 'ManageListenerConfiguration',
                    effect: Effect.ALLOW,
                    actions: [
                        'elasticloadbalancing:SetWebAcl',
                        'elasticloadbalancing:ModifyListener',
                        'elasticloadbalancing:AddListenerCertificates',
                        'elasticloadbalancing:RemoveListenerCertificates',
                        'elasticloadbalancing:ModifyRule',
                        'elasticloadbalancing:SetRulePriorities',
                    ],
                    resources: ['*'],
                }),
            ],
        }),
    });
};
