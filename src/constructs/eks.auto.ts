import { Cluster, ClusterProps, DefaultCapacityType } from "@aws-cdk/aws-eks-v2-alpha";
import { KubectlV33Layer } from "@aws-cdk/lambda-layer-kubectl-v33";
import { KubectlV34Layer } from "@aws-cdk/lambda-layer-kubectl-v34";
import { Duration } from "aws-cdk-lib";
import { InterfaceVpcEndpoint, InterfaceVpcEndpointAwsService, IVpc, Peer, Port, SecurityGroup, SubnetSelection, SubnetType } from "aws-cdk-lib/aws-ec2";
import { ClusterLoggingTypes, EndpointAccess, KubernetesVersion } from "aws-cdk-lib/aws-eks";
import { AccountRootPrincipal, Role } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

const DEFAULT_KUBERNETES_VERSION = KubernetesVersion.V1_33;

/**
 * Function that contains logic to map the correct kunbectl layer based on the passed in version.
 * @param scope in whch the kubectl layer must be created
 * @param version EKS version
 * @returns ILayerVersion or undefined
 */
function selectKubectlLayer(scope: Construct, version: KubernetesVersion): ILayerVersion | undefined {
    switch (version.version) {
        case "1.33":
            return new KubectlV33Layer(scope, "kubectllayer33");
        case "1.34":
            return new KubectlV34Layer(scope, "kubectllayer34");

    }
    return undefined;
}

/**
 * Properties for the EKS cluster platform
 */
export interface EksPlatformProps extends Pick<ClusterProps, "clusterName" | "vpcSubnets" | "mastersRole"> {
    /**
     * The VPC in which to create the Cluster.
     */
    vpc: IVpc;

    /**
     * The Kubernetes version to run in the cluster
     * 
     * @default KubernetesVersion.V1_33
     */
    version?: KubernetesVersion;

    /**
     * Tags for the cluster
     */
    tags?: {
        [key: string]: string;
    }
}

export class EksAutoPlatform extends Construct {
    readonly cluster: Cluster;
    readonly version: KubernetesVersion;

    constructor(scope: Construct, id: string, props: EksPlatformProps) {
        super(scope, id);

        const clusterName = props.clusterName ?? id;
        const version = props.version ?? DEFAULT_KUBERNETES_VERSION;
        const clusterLogging = [ClusterLoggingTypes.API, ClusterLoggingTypes.AUDIT, ClusterLoggingTypes.AUTHENTICATOR, ClusterLoggingTypes.CONTROLLER_MANAGER, ClusterLoggingTypes.SCHEDULER];

        const endpointAccess = EndpointAccess.PRIVATE;
        const vpcSubnets = props.vpcSubnets ?? [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }];
        const mastersRole = props.mastersRole ?? new Role(this, `${clusterName}-AccessRole`, {
            assumedBy: new AccountRootPrincipal(),
        });

        const secretsEncryptionKey = new Key(this, `${clusterName}-SecretsEncryptionKey`, {
            alias: `${clusterName}-secrets-encryption-key`,
            description: `KMS key for encrypting EKS cluster ${clusterName} secrets`,
            enableKeyRotation: true,
            rotationPeriod: Duration.days(90),
        });

        const kubectlLayer = selectKubectlLayer(this, version);
        const kubectlProviderOptions = kubectlLayer && { kubectlLayer };
        const tags = props.tags;

        const defaultOptions: ClusterProps = {
            vpc: props.vpc,
            secretsEncryptionKey,
            clusterName,
            clusterLogging,
            version,
            vpcSubnets,
            endpointAccess,
            kubectlProviderOptions,
            tags,
            mastersRole,
            defaultCapacityType: DefaultCapacityType.AUTOMODE,
        };

        const clusterOptions = { ...defaultOptions, ...props };

        this.cluster = new Cluster(this, 'Cluster', clusterOptions);
        this.cluster.node.addDependency(props.vpc);

        // Add the EKS Auth VPC Endpoint
        this.addEksInterfaceEndpoint(props.vpc, vpcSubnets);
    }

    private addEksInterfaceEndpoint(vpc: IVpc, subnets: SubnetSelection[]) {
        const endpointSecurityGroup = new SecurityGroup(this, 'EksEndpointSG', {
            vpc,
            description: 'Security group for EKS interface endpoint',
            allowAllOutbound: false,
            securityGroupName: 'eks-auth-endpoint-sg',
        });

        // Permit HTTPS ingress from VPC CIDR
        endpointSecurityGroup.addIngressRule(
            Peer.ipv4(vpc.vpcCidrBlock),
            Port.tcp(443),
            'Permit HTTPS access from within VPC',
        );

        new InterfaceVpcEndpoint(this, 'EksAuthInterfaceEndpoint', {
            service: InterfaceVpcEndpointAwsService.EKS_AUTH,
            securityGroups: [endpointSecurityGroup],
            vpc,
            subnets: subnets.length > 0 ? subnets[0] : { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            privateDnsEnabled: true,
        });
    }
}