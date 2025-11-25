import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { FlowLogDestination, IVpc, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

export class VpcStack extends Stack {
  readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Define VPC resources here
    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 3, // Default is all AZs in the region
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'ingress',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false,
        },
        {
          name: 'private',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'data',
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
      restrictDefaultSecurityGroup: true,
    });

    const vpcFlowLogsRole = new Role(this, 'VpcFlowLogsRole', {
      assumedBy: new ServicePrincipal('vpc-flow-logs.amazonaws.com'),
    });
    new ManagedPolicy(this, 'VpcFlowLogsPolicy', {
      roles: [vpcFlowLogsRole],
      statements: [
        new PolicyStatement({
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
          ],
          resources: ['*'],
        })
      ],
    });

    const flowLogGroup = new LogGroup(this, 'VpcFlowLogGroup', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.vpc.addFlowLog('VpcFlowLog', {
      destination: FlowLogDestination.toCloudWatchLogs(
        flowLogGroup,
        vpcFlowLogsRole
      ),
    });

    // Suppress NIST violations
    // Accept default route to IGW because we need public subnets for this example
    NagSuppressions.addResourceSuppressions(
      this.vpc,
      [
        {
          id: 'NIST.800.53.R5-VPCNoUnrestrictedRouteToIGW',
          reason: 'Public subnets require default route to IGW for internet access in this example architecture',
        },
      ],
      true, // applyToChildren
    );

    // Accept non-KMS encrypted CloudWatch log group for cost consideration
    NagSuppressions.addResourceSuppressions(
      flowLogGroup,
      [
        {
          id: 'NIST.800.53.R5-CloudWatchLogGroupEncrypted',
          reason: 'KMS encryption not required for VPC Flow Logs due to cost considerations',
        },
      ],
    );

    // Suppress inline policy warning for VPC Flow Logs role
    NagSuppressions.addResourceSuppressions(
      vpcFlowLogsRole,
      [
        {
          id: 'NIST.800.53.R5-IAMNoInlinePolicy',
          reason: 'Inline policy is automatically created by CDK for VPC Flow Logs role permissions',
        },
      ],
      true, // applyToChildren
    );
  }
}