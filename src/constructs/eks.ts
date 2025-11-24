/**
 * We will develop an EKS Cluster L3 construct that:
 * - Creates the EKS Cluster using @aws-cdk/aws-eks-v2-alpha L2 Cluster construct
 * - Implement CDK-NAG compliance for NIST 800-53 r4 and r5 by proper configuration of the cluster and node groups
 * - Implement Kubernetes STIG compliance by proper configuration of the cluster and node groups
 * - Reference the cdk-eks-blueprints AWS Quickstart project for an example of Interfaces and order of operations in creating the cluster
 * - Reference the cdk-eks-blueprints-patterns project for an example of add-ons that may be valuable to include
 * 
 * 
 */

import { Addon, AddonProps, Cluster, ClusterProps, DefaultCapacityType, Nodegroup } from "@aws-cdk/aws-eks-v2-alpha";
import { KubectlV33Layer } from "@aws-cdk/lambda-layer-kubectl-v33";
import { KubectlV34Layer } from "@aws-cdk/lambda-layer-kubectl-v34";
import { Duration, Tags } from "aws-cdk-lib";
import { IMachineImage, InstanceClass, InstanceSize, InstanceType, InterfaceVpcEndpoint, InterfaceVpcEndpointAwsService, IVpc, LaunchTemplate, LaunchTemplateHttpTokens, OperatingSystemType, Peer, Port, SecurityGroup, SubnetSelection, SubnetType, UserData } from "aws-cdk-lib/aws-ec2";
import { CapacityType, ClusterLoggingTypes, EndpointAccess, KubernetesVersion, NodegroupOptions } from "aws-cdk-lib/aws-eks";
import { AccountRootPrincipal, ManagedPolicy, Role } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { CfnAssociation } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { getMaxPodsForInstance } from "../shared/eni-max-pods";

const DEFAULT_KUBERNETES_VERSION = KubernetesVersion.V1_33;
const DEFAULT_CAPACITY_COUNT = 2;
const DEFAULT_CAPACITY_TYPE = InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM);
const DEFAULT_SERVICE_IPV4_CIDR = '172.20.0.0/16';
const DEFAULT_DNS_CLUSTER_IP = '172.20.0.10';

/**
 * Function that contains logic to map the correct kunbectl layer based on the passed in version.
 * @param scope in whch the kubectl layer must be created
 * @param version EKS version
 * @returns ILayerVersion or undefined
 */
export function selectKubectlLayer(scope: Construct, version: KubernetesVersion): ILayerVersion | undefined {
  switch (version.version) {
    case "1.33":
      return new KubectlV33Layer(scope, "kubectllayer33");
    case "1.34":
      return new KubectlV34Layer(scope, "kubectllayer34");

  }
  return undefined;
}

export interface ManagedNodeGroup extends Omit<NodegroupOptions,
  "subnets" | "amiType" | "nodeRole" | "releaseVersion" | "remoteAccess" | "launchTemplateSpec" | "capacityType"> {
  /**
   * Id of this node group. Expected to be unique in cluster scope.
   */
  id: string;

  /**
   * The custom AMI for the node group.
   */
  machineImage: IMachineImage;

  /**
   * Subnets for the autoscaling group where nodes (instances) will be placed.
   * @default all private subnets
   */
  nodeGroupSubnets?: SubnetSelection;

  /**
   * Automatically join nodes in this node group to Active Directory domain.
   * This requires @directory property to be set in EksPlatformProps.
   * @default false
   */
  enableDomainJoin?: boolean;
}

/**
 * Configuration for Amazon Directory Service MS Active Directory integration
 */
export interface ActiveDirectoryConfig {
  /**
   * The directory ID of the Active Directory
   */
  directoryId: string;

  /**
   * The domain name of the Active Directory
   */
  domainName: string;

  /**
   * The DNS IP addresses of the Active Directory
   */
  dnsIpAddresses: string[];

  /**
   * The organizational unit for computer accounts
   * @default - Root OU
   */
  organizationalUnit?: string;
}

/**
 * Configuration for EKS add-ons with timing control
 */
export interface AddonConfig extends Pick<AddonProps, 'addonName' | 'addonVersion' | 'configurationValues'> {
  /**
   * Whether this add-on should be installed before node groups are created.
   * If false, the add-on will wait for all node groups to be available.
   * @default false
   */
  beforeCompute?: boolean;
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
   * Array of managed node groups.
   */
  managedNodeGroups?: ManagedNodeGroup[];

  /**
   * Active Directory configuration for domain joining
   * @default - No Active Directory integration
   */
  directory?: ActiveDirectoryConfig;

  /**
   * Tags for the cluster
   */
  tags?: {
    [key: string]: string;
  }
}

export class EksPlatform extends Construct {
  readonly cluster: Cluster;
  readonly version: KubernetesVersion;
  readonly nodeGroups: Nodegroup[] = [];


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
      defaultCapacity: 0, // we want to manage capacity ourselves
      defaultCapacityType: DefaultCapacityType.NODEGROUP,
      // albController: // TODO: Add ALB LBC by default
    };

    const clusterOptions = { ...defaultOptions, ...props };

    this.cluster = new Cluster(this, id, clusterOptions);
    this.cluster.node.addDependency(props.vpc);

    let hasWindowsNodes = false;
    for (const n of props.managedNodeGroups ?? []) {
      if (n.machineImage.getImage(this).osType === OperatingSystemType.WINDOWS) {
        hasWindowsNodes = true;
      }

      const nodeGroup = this.addManagedNodeGroup(this.cluster, n, props.directory);
      this.nodeGroups.push(nodeGroup);
    }

    // Add CoreAddons like VPC CNI, CoreDNS, KubeProxy, EksPodIdentityAgent, etc...
    this.addCoreAddons(this.cluster, hasWindowsNodes);

    // TODO: Add HelmAddOns like ClusterAutoScaler, AWS LBC, External Secrets, ArgoCD, etc...
    // this.addHelmAddOns();

    // Add the EKS Auth VPC Endpoint
    this.addEksInterfaceEndpoint(props.vpc, vpcSubnets);
  }

  /**
   * Adds a managed node group to the cluster.
   * @param cluster
   * @param nodeGroup
   * @returns
   */
  addManagedNodeGroup(cluster: Cluster, nodegroup: ManagedNodeGroup, directoryConfig?: ActiveDirectoryConfig): Nodegroup {
    const nodegroupName = nodegroup.nodegroupName ?? nodegroup.id;
    const capacityType = CapacityType.ON_DEMAND;
    const instanceTypes = nodegroup.instanceTypes ?? [DEFAULT_CAPACITY_TYPE];
    const minSize = nodegroup.minSize ?? 1;
    const maxSize = nodegroup.maxSize ?? 3;
    const desiredSize = nodegroup.desiredSize ?? minSize;
    const subnets = nodegroup.nodeGroupSubnets ?? { subnetType: SubnetType.PRIVATE_WITH_EGRESS };

    const nodegroupDefaults: NodegroupOptions = {
      ...nodegroup,
      nodegroupName,
      capacityType,
      instanceTypes,
      minSize,
      maxSize,
      desiredSize,
      subnets,
    };

    // Create a security group for the launch template
    const securityGroup = new SecurityGroup(cluster, `${nodegroup.id}-sg`, {
      vpc: cluster.vpc,
      securityGroupName: `${nodegroupName}-lt-sg`,
      description: `Security group for ${nodegroupName} EKS managed node group launch template`,
      allowAllOutbound: true,
    });
    Tags.of(securityGroup).add(`kubernetes.io/cluster/${cluster.clusterName}`, 'owned');

    // Create the User Data for the launch template
    const userData = this.createUserData(cluster, nodegroup.machineImage, nodegroupDefaults);

    // Create the launch template for the node group
    const lt = new LaunchTemplate(cluster, `${nodegroup.id}-lt`, {
      machineImage: nodegroup.machineImage,
      securityGroup,
      userData,
      requireImdsv2: true,
      httpPutResponseHopLimit: 2,
      httpTokens: LaunchTemplateHttpTokens.REQUIRED,
    });

    // Add cluster security group to permit worker nodes to reach the control plane
    lt.addSecurityGroup(cluster.clusterSecurityGroup);

    // Tag launch template with cluster ownership
    Tags.of(lt).add(`kubernetes.io/cluster/${cluster.clusterName}`, 'owned');

    // Attach launch template to node group options
    const nodegroupOptions = {
      ...nodegroupDefaults,
      launchTemplateSpec: {
        id: lt.launchTemplateId!,
        version: lt.latestVersionNumber,
      },
    };

    // Add the node group to the cluster
    const ng = cluster.addNodegroupCapacity(nodegroup.id + '-ng', nodegroupOptions);

    // Attach the AmazonSSMManagedInstanceCore policy to the node role for SSM access
    ng.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    // Automatically joins nodes to Active Directory domain if enabled
    if (nodegroup.enableDomainJoin && directoryConfig) {
      new CfnAssociation(this, `DomainJoinAssociation-${nodegroup.nodegroupName}`, {
        name: 'AWS-JoinDirectoryServiceDomain',
        targets: [
          {
            key: 'tag:eks:nodegroup-name',
            values: [ng.nodegroupName],
          },
        ],
        parameters: {
          directoryId: [directoryConfig.directoryId],
          directoryName: [directoryConfig.domainName],
          directoryOU: directoryConfig.organizationalUnit ? [directoryConfig.organizationalUnit] : [],
        },
        maxConcurrency: '10',
        maxErrors: '5',
        complianceSeverity: 'MEDIUM',
      });
    }

    // TODO: Need to figure out how to map the role in v2 because they removed AwsAuth
    // but under the hood its just a ConfigMap using KubernetesManifest construct
    // If the node group osType is Windows, add the eks:kube-proxy-windows group to allow
    // kube-proxy to function correctly on Windows nodes
    // if (nodegroup.machineImage.getImage(this).osType === OperatingSystemType.WINDOWS) {
    //     cluster.awsAuth.addRoleMapping(nodeRole, {
    //         groups: ['system:nodes', 'system:bootstrappers', 'eks:kube-proxy-windows'],
    //         username: 'system:node:{{EC2PrivateDNSName}}',
    //     });
    // }

    return ng;
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


  /**
   * Create user data for a node group
   * @param cluster EKS Cluster
   * @param nodegroup Managed Node Group config
   * @returns UserData object
   */
  private createUserData(
    cluster: Cluster,
    machineImage: IMachineImage,
    options: NodegroupOptions,
  ): UserData {
    // Construct node labels
    const nodeLabels = [
      `eks.amazonaws.com/nodegroup-image=${machineImage.getImage(this).imageId}`,
      'eks.amazonaws.com/capacityType=ON_DEMAND',
      `eks.amazonaws.com/nodegroup=${options.nodegroupName}`,
    ];
    if (options.labels) {
      for (const [key, value] of Object.entries(options.labels)) {
        nodeLabels.push(`${key}=${value}`);
      }
    }
    const nodeLabelString = nodeLabels.join(',');

    // Determine the min of max pods supported across all instance types
    const maxPodsSupport = [];
    for (const instanceType of options.instanceTypes ?? [DEFAULT_CAPACITY_TYPE]) {
      maxPodsSupport.push(getMaxPodsForInstance(instanceType, 17));
    }
    const maxPods = Math.min(...maxPodsSupport);

    // Default to Linux user data
    let content = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="//"',
      '',
      '--//',
      'Content-Type: application/node.eks.aws',
      '',
      '---',
      'apiVersion: node.eks.aws/v1alpha1',
      'kind: NodeConfig',
      'spec:',
      '  cluster:',
      `    apiServerEndpoint: ${cluster.clusterEndpoint}`,
      `    certificateAuthority: ${cluster.clusterCertificateAuthorityData}`,
      `    cidr: ${DEFAULT_SERVICE_IPV4_CIDR}`,
      `    name: ${cluster.clusterName}`,
      '  kubelet:',
      '    config:',
      `      maxPods: ${maxPods}`,
      '      clusterDNS:',
      `      - ${DEFAULT_DNS_CLUSTER_IP}`,
      '    flags:',
      `    - "--node-labels=${nodeLabelString}"`,
      '--//--',
    ].join('\n');

    // If Window, override the user data content
    if (machineImage.getImage(this).osType === OperatingSystemType.WINDOWS) {
      // EC2Launch v2 expects YAML format for user data
      content = `version: 1.0
    tasks:
      - task: executeScript
        inputs:
          - frequency: always
            type: powershell
            runAs: admin
            content: |-
              Write-Output "Starting EKS bootstrap process..."
              [string]$EKSBootstrapScriptFile = "$env:ProgramFiles\\Amazon\\EKS\\Start-EKSBootstrap.ps1"
              & $EKSBootstrapScriptFile -EKSClusterName "${cluster.clusterName}" -APIServerEndpoint "${cluster.clusterEndpoint}" -Base64ClusterCA "${cluster.clusterCertificateAuthorityData}" -DNSClusterIP "${DEFAULT_DNS_CLUSTER_IP}" -ServiceCIDR "${DEFAULT_SERVICE_IPV4_CIDR}" -KubeletExtraArgs "--node-labels=${nodeLabelString} --max-pods ${maxPods}"
              
              Write-Output "EKS bootstrap script completed successfully"`;
    }

    return UserData.custom(content);
  }

  /**
   * Installs EKS managed add-ons
   * @param hasWindowsNodes determines if the cluster has Windows nodes 
   */
  private addCoreAddons(cluster: Cluster, hasWindowsNodes: boolean): void {
    // Core add-ons with their default timing preferences
    const coreAddons: AddonConfig[] = [
      {
        addonName: 'vpc-cni',
        beforeCompute: true,
        ...(hasWindowsNodes && {
          configurationValues: {
            enableWindowsIpam: 'true',
          },
        }),
      },
      {
        addonName: 'kube-proxy',
      },
      {
        addonName: 'eks-pod-identity-agent',
        beforeCompute: true,
      },
      {
        addonName: 'coredns',
        configurationValues: this.generateCoreDnsConfig(),
      },
    ];

    // Install all add-ons with conditional node group dependencies
    for (const config of coreAddons) {
      const addon = new Addon(this, `${config.addonName}Addon`, { ...config, cluster });

      // Add dependency on all node groups if beforeCompute is not true (default behavior)
      if (config.beforeCompute !== true) {
        for (const nodeGroup of this.nodeGroups.values()) {
          addon.node.addDependency(nodeGroup);
        }
      }
    }
  }

  /**
   * Generates CoreDNS configuration with Active Directory conditional forwarding
   */
  private generateCoreDnsConfig(domainName?: string, dnsIpAddresses?: string[]): Record<string, any> {
    if (!domainName || !dnsIpAddresses || dnsIpAddresses.length === 0) {
      return {};
    }

    const baseCorefile = `.:53 {
    errors
    health {
        lameduck 5s
    }
    ready
    kubernetes cluster.local in-addr.arpa ip6.arpa {
      pods insecure
      fallthrough in-addr.arpa ip6.arpa
    }
    prometheus :9153
    forward . /etc/resolv.conf
    cache 30
    loop
    reload
    loadbalance
}
${domainName}:53 {
    errors
    cache 30
    forward . ${dnsIpAddresses?.join(' ')}
    reload
}`;

    return {
      corefile: baseCorefile,
    };
  }
}