import { KubernetesVersion } from "aws-cdk-lib/aws-eks";

export const AWS_ACCOUNT_ID = '008971673260';
export const AWS_REGION = 'us-east-1';


export const EKS_SERVICE_IPV4_CIDR = '172.20.0.0/16';
export const EKS_DNS_CLUSTER_IP = '172.20.0.10';
export const EKS_VERSION = KubernetesVersion.V1_33;
export const EKS_OPTIMIZED_AL2023_AMI_PATTERN = `amazon-eks-node-al2023-x86_64-standard-${EKS_VERSION.version}*`;
export const EKS_OPTIMIZED_WINDOWS_AMI_PATTERN = `Windows_Server-2022-English-Core-EKS_Optimized-${EKS_VERSION.version}*`;