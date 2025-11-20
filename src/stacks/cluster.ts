import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { TaintEffect } from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { EKS_OPTIMIZED_AL2023_AMI_PATTERN } from '../constants';
import { EksPlatform } from '../constructs/eksv2';

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
            name: EKS_OPTIMIZED_AL2023_AMI_PATTERN,
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
  }
}