import { Aspects, Stage, StageProps } from 'aws-cdk-lib';
import { NIST80053R5Checks } from 'cdk-nag/lib/packs/nist-800-53-r5';
import { ClusterStack } from '../stacks/cluster';
import { VpcStack } from '../stacks/vpc';

export class ExampleStage extends Stage {
    constructor(scope: Stage, id: string, props?: StageProps) {
        super(scope, id, props);

        // Create VPC Stack
        const vpc = new VpcStack(this, 'VpcStack', props);

        // Create EKS Cluster Stack
        new ClusterStack(this, 'ClusterStack', {
            ...props,
            vpc: vpc.vpc,
        });

        Aspects.of(this).add(new NIST80053R5Checks({ verbose: true }));
    }
}