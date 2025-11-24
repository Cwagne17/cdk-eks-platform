import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { FlowLogDestination, IVpc, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
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

    this.vpc.addFlowLog('VpcFlowLog', {
      destination: FlowLogDestination.toCloudWatchLogs(
        new LogGroup(this, 'VpcFlowLogGroup', {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY
        }),
        vpcFlowLogsRole
      ),
    });
  }
}