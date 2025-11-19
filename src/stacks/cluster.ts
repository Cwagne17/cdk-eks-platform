import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs/lib/construct";

export class ClusterStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // Define EKS Cluster resources here
    }
}