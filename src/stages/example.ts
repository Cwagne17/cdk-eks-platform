import { Stage, StageProps } from "aws-cdk-lib";
import { ClusterStack } from "../stacks/cluster";
import { VpcStack } from "../stacks/vpc";

export class ExampleStage extends Stage {
    constructor(scope: Stage, id: string, props?: StageProps) {
        super(scope, id, props);

        // Create VPC Stack
        const vpc = new VpcStack(this, 'VpcStack', props);

        // Create EKS Cluster Stack
        new ClusterStack(this, 'ClusterStack', {
            ...props,
            // You can pass the VPC created above to the ClusterStack if needed
            // vpc: vpc.vpc,
        });
    }
}