import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { TaintEffect } from 'aws-cdk-lib/aws-eks';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import { EKS_OPTIMIZED_AL2023_AMI_PATTERN, EKS_OPTIMIZED_WINDOWS_AMI_PATTERN } from '../constants';
import { EksPlatform } from '../constructs/eks';

export interface ClusterStackProps extends StackProps {
  readonly vpc?: ec2.IVpc;
}

export class ClusterStack extends Stack {
  public readonly cluster: EksPlatform;

  constructor(scope: Construct, id: string, props?: ClusterStackProps) {
    super(scope, id, props);

    // Get or create VPC
    const vpc = props?.vpc || ec2.Vpc.fromLookup(this, 'DefaultVpc', {
      isDefault: true,
    });

    // Create EKS Platform with example configuration
    this.cluster = new EksPlatform(this, 'EksPlatform', {
      clusterName: 'ex-eks-managed-node-group',
      vpc: vpc,
      managedNodeGroups: [
        {
          id: 'windows',
          machineImage: ec2.MachineImage.lookup({
            name: EKS_OPTIMIZED_WINDOWS_AMI_PATTERN,
            windows: true,
          }),
          taints: [{ key: 'os', value: 'windows', effect: TaintEffect.NO_SCHEDULE }],
        },
        {
          id: 'al2023',
          machineImage: ec2.MachineImage.lookup({
            name: EKS_OPTIMIZED_AL2023_AMI_PATTERN,
          }),
        }
      ],
    });

    // Suppress NIST violations for Kubectl Provider Lambda functions (not under our control)
    // These are created automatically by the Cluster construct and cannot be modified
    NagSuppressions.addResourceSuppressions(
      this.cluster.cluster,
      [
        {
          id: 'NIST.800.53.R5-IAMNoInlinePolicy',
          reason: 'Inline policies are created automatically by CDK for Kubectl Provider Lambda functions and cannot be modified',
        },
        {
          id: 'NIST.800.53.R5-LambdaConcurrency',
          reason: 'Lambda concurrency limits not configurable for CDK-managed Kubectl Provider functions',
        },
        {
          id: 'NIST.800.53.R5-LambdaDLQ',
          reason: 'Dead-letter queue not configurable for CDK-managed Kubectl Provider functions',
        },
      ],
      true, // applyToChildren
    );

    // Suppress validation failures for EKS endpoint security group (intrinsic function limitations)
    NagSuppressions.addResourceSuppressions(
      this.cluster,
      [
        {
          id: 'CdkNagValidationFailure',
          reason: 'Security group rules use VPC CIDR intrinsic function which cannot be validated by CDK Nag',
        },
      ],
      true, // applyToChildren
    );
  }
}