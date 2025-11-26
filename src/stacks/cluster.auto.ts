import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { EksAutoPlatform } from '../constructs/eks.auto';

export interface ClusterAutoStackProps extends StackProps {
    readonly vpc?: ec2.IVpc;
}

export class ClusterAutoStack extends Stack {
    public readonly cluster: EksAutoPlatform;

    constructor(scope: Construct, id: string, props?: ClusterAutoStackProps) {
        super(scope, id, props);

        // Get or create VPC
        const vpc = props?.vpc || ec2.Vpc.fromLookup(this, 'DefaultVpc', {
            isDefault: true,
        });

        // Create EKS Platform with example configuration
        this.cluster = new EksAutoPlatform(this, 'EksPlatform', {
            clusterName: 'ex-eks-managed-node-group',
            vpc: vpc,
        });
    }
}