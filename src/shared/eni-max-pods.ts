import { InstanceType } from 'aws-cdk-lib/aws-ec2';

/**
 * Maps instance type strings to maximum pods supported by Amazon VPC CNI
 * Based on https://github.com/aws/amazon-vpc-cni-k8s/blob/master/misc/eni-max-pods.txt
 *
 * Includes only the latest instance families: m5, m6g, t3, t4g, c5, c6g, r5, r6g
 */
const ENI_MAX_PODS_MAP: Record<string, number> = {
    // C5 family (Compute Optimized - x86)
    'c5.large': 29,
    'c5.xlarge': 58,
    'c5.2xlarge': 58,
    'c5.4xlarge': 234,
    'c5.9xlarge': 234,
    'c5.12xlarge': 234,
    'c5.18xlarge': 737,
    'c5.24xlarge': 737,
    'c5.metal': 737,

    // C6G family (Compute Optimized - ARM Graviton2)
    'c6g.medium': 8,
    'c6g.large': 29,
    'c6g.xlarge': 58,
    'c6g.2xlarge': 58,
    'c6g.4xlarge': 234,
    'c6g.8xlarge': 234,
    'c6g.12xlarge': 234,
    'c6g.16xlarge': 737,
    'c6g.metal': 737,

    // M5 family (General Purpose - x86)
    'm5.large': 29,
    'm5.xlarge': 58,
    'm5.2xlarge': 58,
    'm5.4xlarge': 234,
    'm5.8xlarge': 234,
    'm5.12xlarge': 234,
    'm5.16xlarge': 737,
    'm5.24xlarge': 737,
    'm5.metal': 737,

    // M6G family (General Purpose - ARM Graviton2)
    'm6g.medium': 8,
    'm6g.large': 29,
    'm6g.xlarge': 58,
    'm6g.2xlarge': 58,
    'm6g.4xlarge': 234,
    'm6g.8xlarge': 234,
    'm6g.12xlarge': 234,
    'm6g.16xlarge': 737,
    'm6g.metal': 737,

    // R5 family (Memory Optimized - x86)
    'r5.large': 29,
    'r5.xlarge': 58,
    'r5.2xlarge': 58,
    'r5.4xlarge': 234,
    'r5.8xlarge': 234,
    'r5.12xlarge': 234,
    'r5.16xlarge': 737,
    'r5.24xlarge': 737,
    'r5.metal': 737,

    // R6G family (Memory Optimized - ARM Graviton2)
    'r6g.medium': 8,
    'r6g.large': 29,
    'r6g.xlarge': 58,
    'r6g.2xlarge': 58,
    'r6g.4xlarge': 234,
    'r6g.8xlarge': 234,
    'r6g.12xlarge': 234,
    'r6g.16xlarge': 737,
    'r6g.metal': 737,

    // T3 family (Burstable - x86)
    't3.nano': 4,
    't3.micro': 4,
    't3.small': 11,
    't3.medium': 17,
    't3.large': 35,
    't3.xlarge': 58,
    't3.2xlarge': 58,

    // T4G family (Burstable - ARM Graviton2)
    't4g.nano': 4,
    't4g.micro': 4,
    't4g.small': 11,
    't4g.medium': 17,
    't4g.large': 35,
    't4g.xlarge': 58,
    't4g.2xlarge': 58,
};

/**
 * Gets the maximum number of pods supported by an EC2 instance type
 * based on Amazon VPC CNI ENI limits.
 *
 * @param instanceType - The EC2 instance type
 * @param defaultValue - Default value if instance type is not found (default: 17)
 * @returns Maximum number of pods, or defaultValue if not found
 */
export function getMaxPodsForInstance(instanceType: InstanceType, defaultValue: number = 17): number {
    return ENI_MAX_PODS_MAP[instanceType.toString()] ?? defaultValue;
}