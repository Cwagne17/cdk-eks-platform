import { Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { NagSuppressions } from 'cdk-nag';
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