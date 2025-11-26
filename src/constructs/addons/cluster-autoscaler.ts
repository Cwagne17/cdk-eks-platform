import { Cluster, HelmChart, IdentityType, Nodegroup, ServiceAccount } from "@aws-cdk/aws-eks-v2-alpha";
import { CfnJson, Duration, Names, Stack, Tags } from "aws-cdk-lib";
import { Effect, ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

const NAME = "cluster-autoscaler";

export interface ClusterAutoscalerOptions {
    /**
     * Version of the controller.
     */
    readonly version: string;
}

export interface ClusterAutoscalerProps extends ClusterAutoscalerOptions {
    /**
     * Cluster to install the addon onto.
     */
    readonly cluster: Cluster;
}

export class ClusterAutoscalerAddOn extends Construct {
    private readonly clusterName: CfnJson;

    /**
   * Create the controller construct associated with this cluster and scope.
   *
   * Singleton per stack/cluster.
   */
    public static create(scope: Construct, props: ClusterAutoscalerProps) {
        const stack = Stack.of(scope);
        const uid = ClusterAutoscalerAddOn.uid(props.cluster);
        return new ClusterAutoscalerAddOn(stack, uid, props);
    }

    private static uid(cluster: Cluster) {
        return `${Names.nodeUniqueId(cluster.node)}-ClusterAutoscaler`;
    }

    public constructor(scope: Construct, id: string, props: ClusterAutoscalerProps) {
        super(scope, id);

        // Set the cluster name using CfnJson to avoid issues with late-bound names
        this.clusterName = new CfnJson(props.cluster.stack, 'clusterName', {
            value: props.cluster.clusterName,
        })

        const namespace = 'kube-system';
        const serviceAccountName = NAME;
        const helmChartVersion = props.version;

        // Create IAM role for the service account (IRSA/Pod Identity)
        // const role = new Role(this, 'ServiceAccountRole', {
        //     assumedBy: new ServicePrincipal('pods.eks.amazonaws.com'),
        //     roleName: `${props.cluster.clusterName}-${serviceAccountName}-role`,
        // });
        const serviceAccount = new ServiceAccount(this, 'ServiceAccount', {
            cluster: props.cluster,
            namespace,
            name: serviceAccountName,
            identityType: IdentityType.POD_IDENTITY
        });

        // Add the managed policy to the role
        serviceAccount.role.addManagedPolicy(ClusterAutoscalerIamPolicy(this, this.clusterName));

        // Create Pod Identity Association to bind the IAM role to the ServiceAccount
        // const podIdentity = new CfnPodIdentityAssociation(this, `${namespace}-${serviceAccountName}PodIdentity`, {
        //     clusterName: props.cluster.clusterName,
        //     namespace,
        //     serviceAccount: serviceAccountName,
        //     roleArn: role.roleArn,
        //     tags: [
        //         {
        //             key: 'Name',
        //             value: `${namespace}-${serviceAccountName}-pod-identity`,
        //         },
        //     ],
        // });

        const chart = new HelmChart(this, 'Resource', {
            cluster: props.cluster,
            chart: NAME,
            repository: 'https://kubernetes.github.io/autoscaler',
            namespace,
            release: NAME,
            version: helmChartVersion,

            wait: true,
            timeout: Duration.minutes(15),
            values: {
                awsRegion: Stack.of(this).region,
                autoDiscovery: {
                    clusterName: props.cluster.clusterName,
                },
                rbac: {
                    serviceAccount: {
                        create: false,
                        name: serviceAccountName,
                    }
                },
                extraArgs: {
                    'skip-nodes-with-system-pods': false,
                },
                nodeSelector: {
                    'kubernetes.io/os': 'linux',
                },
            },
        });

        // Ensure pod identity association is created before Helm chart
        // This ensures the ServiceAccount can assume the IAM role when pods start
        // chart.node.addDependency(podIdentity);
    }

    /**
     * Enroll a nodegroup for auto-discovery by adding the required tags.
     * @param nodegroup 
     */
    enableAutoDiscovery(nodegroup: Nodegroup) {
        Tags.of(nodegroup).add('k8s.io/cluster-autoscaler/enabled', 'true', { applyToLaunchedInstances: true });
        Tags.of(nodegroup).add(`k8s.io/cluster-autoscaler/${this.clusterName}`, 'owned', { applyToLaunchedInstances: true });
    }
}

export const ClusterAutoscalerIamPolicy = (scope: Construct, clusterName: CfnJson) => {
    return new ManagedPolicy(scope, 'ClusterAutoscalerPolicy', {
        statements: [
            new PolicyStatement({
                actions: [
                    "autoscaling:SetDesiredCapacity",
                    "autoscaling:TerminateInstanceInAutoScalingGroup"
                ],
                resources: ["*"],
                conditions: {
                    StringEquals: {
                        "aws:ResourceTag/k8s.io/cluster-autoscaler/enabled": "true",
                        [`aws:ResourceTag/k8s.io/cluster-autoscaler/${clusterName}`]: "owned"
                    }
                },
                effect: Effect.ALLOW,
            }),
            new PolicyStatement({
                actions: [
                    "autoscaling:DescribeAutoScalingGroups",
                    "autoscaling:DescribeAutoScalingInstances",
                    "autoscaling:DescribeLaunchConfigurations",
                    "autoscaling:DescribeScalingActivities",
                    "autoscaling:DescribeTags",
                    "ec2:DescribeImages",
                    "ec2:DescribeInstanceTypes",
                    "ec2:DescribeLaunchTemplateVersions",
                    "ec2:GetInstanceTypesFromInstanceRequirements",
                    "eks:DescribeNodegroup"
                ],
                resources: ["*"],
                effect: Effect.ALLOW,
            }),
        ],
    });
};