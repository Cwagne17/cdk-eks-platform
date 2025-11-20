import { KubectlV33Layer } from '@aws-cdk/lambda-layer-kubectl-v33';
import {
  Duration,
  RemovalPolicy,
  Tags
} from 'aws-cdk-lib';
import { IMachineImage, InstanceClass, InstanceSize, InstanceType, InterfaceVpcEndpoint, InterfaceVpcEndpointAwsService, IVpc, LaunchTemplate, LaunchTemplateHttpTokens, OperatingSystemType, Peer, Port, SecurityGroup, SubnetSelection, UserData } from 'aws-cdk-lib/aws-ec2';
import { Addon, AddonProps, AlbControllerVersion, AuthenticationMode, Cluster, ClusterLoggingTypes, EndpointAccess, KubernetesVersion, Nodegroup, TaintSpec } from 'aws-cdk-lib/aws-eks';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { CfnAssociation } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { EKS_DNS_CLUSTER_IP, EKS_SERVICE_IPV4_CIDR, EKS_VERSION } from '../constants';
import { getMaxPodsForInstance } from '../shared/eni-max-pods';

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
 * Configuration for Active Directory integration
 */
export interface ActiveDirectoryConfig {
  /**
   * The domain name of the Active Directory
   */
  readonly domainName: string;

  /**
   * The DNS IP addresses of the Active Directory
   */
  readonly dnsIpAddresses: string[];

  /**
   * The organizational unit for computer accounts
   * @default - Root OU
   */
  readonly organizationalUnit?: string;
}

/**
 * Configuration for a node group
 */
export interface NodeGroupConfig {
  /**
   * The name of the node group
   */
  readonly name: string;

  /**
   * The machine image to use for the node group
   */
  readonly machineImage: IMachineImage;

  /**
   * The instance type for the node group
   * @default t3.medium
   */
  readonly instanceType?: InstanceType;

  /**
   * Minimum number of instances
   * @default 1
   */
  readonly min?: number;

  /**
   * Maximum number of instances
   * @default 3
   */
  readonly max?: number;

  /**
   * Desired number of instances
   * @default 2
   */
  readonly desired?: number;

  /**
   * Labels to apply to the node group
   * @default - No labels
   */
  readonly labels?: { [key: string]: string };

  /**
   * Taints to apply to the node group
   * @default - No taints
   */
  readonly taints?: TaintSpec[];

  /**
   * Enable domain joining for this node group
   * @default false
   */
  readonly enableDomainJoin?: boolean;
}

/**
 * Properties for the EKS Platform construct
 */
export interface EksPlatformProps {
  /**
   * The base name for all resources created by this construct
   */
  readonly name: string;

  /**
   * The VPC to deploy the cluster into
   */
  readonly vpc: IVpc;

  /**
   * Subnet selection for the cluster
   */
  readonly subnets: SubnetSelection;

  /**
   * Removal policy for the cluster
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Active Directory configuration for domain joining
   * @default - No Active Directory integration
   */
  readonly directory?: ActiveDirectoryConfig;

  /**
   * Node groups to create
   * @default - No node groups
   */
  readonly nodeGroups?: NodeGroupConfig[];

  /**
   * Kubernetes version for the cluster
   * @default - Latest version
   */
  readonly version?: KubernetesVersion;
}

/**
 * L3 Construct for creating an opinionated EKS cluster with advanced features
 */
export class EksPlatform extends Construct {
  static readonly DEFAULT_INSTANCE_TYPE = InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM);

  /**
   * The EKS cluster
   */
  public readonly cluster: Cluster;

  /**
   * The node groups created
   */
  public readonly nodeGroups: Map<string, Nodegroup> = new Map();

  /**
   * The installed add-ons
   */
  public readonly addons: Addon[] = [];

  constructor(scope: Construct, id: string, props: EksPlatformProps) {
    super(scope, id);

    // Create the EKS cluster
    this.cluster = this.createCluster(props);

    // NOTE: Tag VPC resources for Kubernetes
    // This may be done automatically by the Cluster construct from aws-cdk-lib
    // The cluster construct should automatically tag subnets with:
    // - kubernetes.io/cluster/<cluster-name>: shared
    // - kubernetes.io/role/internal-elb: 1 (for private subnets)
    // - kubernetes.io/role/elb: 1 (for public subnets)

    // Create node groups if specified
    if (props.nodeGroups && props.nodeGroups.length > 0) {
      this.createNodeGroups(props.nodeGroups, props.directory);
    }

    // Install add-ons
    const hasWindowsNodes = props.nodeGroups?.some(ng => ng.machineImage.getImage(this).osType === OperatingSystemType.WINDOWS) ?? false;
    this.installAddons(hasWindowsNodes);

    // Create EKS interface endpoint for private cluster access
    this.createEksInterfaceEndpoint(props.vpc, props.subnets);
  }

  /**
   * Create the EKS cluster
   */
  private createCluster(props: EksPlatformProps): Cluster {
    const kmsKey = new Key(this, 'EksClusterKmsKey', {
      enableKeyRotation: true,
      rotationPeriod: Duration.days(90),
      alias: `${props.name}-eks-kms-key`,
      description: `KMS key for EKS cluster ${props.name} secrets encryption`,
    });

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: props.name,
      vpc: props.vpc,
      vpcSubnets: [props.subnets],
      version: props.version || EKS_VERSION,
      defaultCapacity: 0, // We'll manage node groups explicitly
      endpointAccess: EndpointAccess.PRIVATE,
      kubectlLayer: new KubectlV33Layer(this, 'kubectl'),
      placeClusterHandlerInVpc: true,
      secretsEncryptionKey: kmsKey,
      serviceIpv4Cidr: EKS_SERVICE_IPV4_CIDR,
      albController: {
        version: AlbControllerVersion.V2_8_2,
      },
      clusterLogging: [ClusterLoggingTypes.API, ClusterLoggingTypes.AUDIT, ClusterLoggingTypes.AUTHENTICATOR, ClusterLoggingTypes.CONTROLLER_MANAGER, ClusterLoggingTypes.SCHEDULER],
      authenticationMode: AuthenticationMode.API_AND_CONFIG_MAP,
      removalPolicy: props.removalPolicy || RemovalPolicy.RETAIN,
    });

    return cluster;
  }

  /**
   * Create node groups for the cluster
   */
  private createNodeGroups(
    nodeGroupConfigs: NodeGroupConfig[],
    directoryConfig?: ActiveDirectoryConfig,
  ): void {
    for (const config of nodeGroupConfigs) {
      // Create node role
      const nodeRole = this.createNodeRole(config.name);

      // Create launch template
      const launchTemplate = this.createLaunchTemplate(config);

      // Create the node group
      const nodegroup = this.cluster.addNodegroupCapacity(config.name, {
        nodegroupName: config.name,
        instanceTypes: config.instanceType ? [config.instanceType] : [EksPlatform.DEFAULT_INSTANCE_TYPE],
        minSize: config.min ?? 1,
        maxSize: config.max ?? 3,
        desiredSize: config.desired ?? 2,
        labels: config.labels,
        taints: config.taints,
        nodeRole: nodeRole,
        launchTemplateSpec: {
          id: launchTemplate.launchTemplateId!,
          version: launchTemplate.latestVersionNumber,
        },
      });

      this.nodeGroups.set(config.name, nodegroup);

      // Setup domain joining if enabled
      if (config.enableDomainJoin && directoryConfig) {
        this.setupDomainJoining(nodegroup, directoryConfig);
      }

      // Check if Windows and add awsAuth role mapping for eks:kube-proxy-windows
      const osType = config.machineImage.getImage(this).osType;
      if (osType === OperatingSystemType.WINDOWS) {
        this.cluster.awsAuth.addRoleMapping(nodeRole, {
          groups: ['system:nodes', 'system:bootstrappers', 'eks:kube-proxy-windows'],
          username: 'system:node:{{EC2PrivateDNSName}}',
        });
      }
    }
  }

  /**
   * Create an IAM role for a node group
   */
  private createNodeRole(nodeGroupName: string): Role {
    const role = new Role(this, `NodeRole-${nodeGroupName}`, {
      roleName: `${this.cluster.clusterName}-${nodeGroupName}-NodeRole`,
      assumedBy: new ServicePrincipal('amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    return role;
  }

  /**
   * Create a launch template for a node group
   */
  private createLaunchTemplate(
    config: NodeGroupConfig,
  ): LaunchTemplate {
    const nodeLabels = [
      `eks.amazonaws.com/nodegroup-image=${config.machineImage.getImage(this).imageId}`,
      'eks.amazonaws.com/capacityType=ON_DEMAND',
      `eks.amazonaws.com/nodegroup=${config.name}`,
    ];

    // Add additional labels from config
    if (config.labels) {
      for (const [key, value] of Object.entries(config.labels)) {
        nodeLabels.push(`${key}=${value}`);
      }
    }
    const nodeLabelString = nodeLabels.join(',');

    const maxPods = getMaxPodsForInstance(config.instanceType ?? EksPlatform.DEFAULT_INSTANCE_TYPE, 17);

    const userData = this.createUserData(config.machineImage.getImage(this).osType, maxPods, nodeLabelString);

    const securityGroup = new SecurityGroup(this, `NodeGroupSG-${config.name}`, {
      vpc: this.cluster.vpc,
      description: `Security group for EKS node group ${config.name}`,
      allowAllOutbound: true,
      securityGroupName: `${this.cluster.clusterName}-${config.name}-sg`,
    });

    // Tag the security group for ALB Controller integration
    Tags.of(securityGroup).add(`kubernetes.io/cluster/${this.cluster.clusterName}`, 'owned');

    const launchTemplate = new LaunchTemplate(this, `LaunchTemplate-${config.name}`, {
      launchTemplateName: `${this.cluster.clusterName}-${config.name}`,
      machineImage: config.machineImage,
      userData: userData,
      securityGroup,
      requireImdsv2: true,
      httpPutResponseHopLimit: 2,
      httpTokens: LaunchTemplateHttpTokens.REQUIRED,
    });

    launchTemplate.addSecurityGroup(this.cluster.clusterSecurityGroup);

    // Tag launch template with cluster ownership for ALB Controller
    Tags.of(launchTemplate).add(`kubernetes.io/cluster/${this.cluster.clusterName}`, 'owned');

    return launchTemplate;
  }

  /**
   * Create user data for a node group
   * @param osType the operating system type
   * @param maxPods the maximum number of pods
   * @param nodeLabelString the node label string
   * @returns UserData object
   */
  private createUserData(
    osType: OperatingSystemType,
    maxPods: number,
    nodeLabelString: string,
  ): UserData {
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
      `    apiServerEndpoint: ${this.cluster.clusterEndpoint}`,
      `    certificateAuthority: ${this.cluster.clusterCertificateAuthorityData}`,
      `    cidr: ${EKS_SERVICE_IPV4_CIDR}`,
      `    name: ${this.cluster.clusterName}`,
      '  kubelet:',
      '    config:',
      `      maxPods: ${maxPods}`,
      '      clusterDNS:',
      `      - ${EKS_DNS_CLUSTER_IP}`,
      '    flags:',
      `    - "--node-labels=${nodeLabelString}"`,
      '--//--',
    ].join('\n');

    if (osType === OperatingSystemType.WINDOWS) {
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
          & $EKSBootstrapScriptFile -EKSClusterName "${this.cluster.clusterName}" -APIServerEndpoint "${this.cluster.clusterEndpoint}" -Base64ClusterCA "${this.cluster.clusterCertificateAuthorityData}" -DNSClusterIP "${EKS_DNS_CLUSTER_IP}" -ServiceCIDR "${EKS_SERVICE_IPV4_CIDR}" -KubeletExtraArgs "--node-labels=${nodeLabelString} --max-pods ${maxPods}"
          
          Write-Output "EKS bootstrap script completed successfully"`;
    }

    return UserData.custom(content);
  }

  /**
   * Setup domain joining for a node group using SSM Association
   */
  private setupDomainJoining(
    nodegroup: Nodegroup,
    directoryConfig: ActiveDirectoryConfig,
  ): void {
    new CfnAssociation(this, `DomainJoinAssociation-${nodegroup.nodegroupName}`, {
      name: 'AWS-JoinDirectoryServiceDomain',
      targets: [
        {
          key: 'tag:eks:nodegroup-name',
          values: [nodegroup.nodegroupName],
        },
      ],
      parameters: {
        directoryId: [directoryConfig.domainName],
        directoryName: [directoryConfig.domainName],
        directoryOU: directoryConfig.organizationalUnit ? [directoryConfig.organizationalUnit] : [],
      },
      maxConcurrency: '10',
      maxErrors: '5',
      complianceSeverity: 'MEDIUM',
    });
  }

  /**
   * Installs EKS managed add-ons
   * @param hasWindowsNodes determines if the cluster has Windows nodes 
   */
  private installAddons(hasWindowsNodes: boolean): void {
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
      const addon = new Addon(this, `${config.addonName}Addon`, { ...config, cluster: this.cluster });

      // Add dependency on all node groups if beforeCompute is not true (default behavior)
      if (config.beforeCompute !== true) {
        for (const nodeGroup of this.nodeGroups.values()) {
          addon.node.addDependency(nodeGroup);
        }
      }

      this.addons.push(addon);
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

  private createEksInterfaceEndpoint(vpc: IVpc, subnets: SubnetSelection): void {
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
      'Allow HTTPS access from VPC',
    );

    new InterfaceVpcEndpoint(this, 'EksAuthInterfaceEndpoint', {
      service: InterfaceVpcEndpointAwsService.EKS_AUTH,
      securityGroups: [endpointSecurityGroup],
      vpc,
      subnets,
      privateDnsEnabled: true,
    });
  }
}
