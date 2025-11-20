import { awscdk } from 'projen';
import { NodePackageManager } from 'projen/lib/javascript';
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'cdk-eks-platform',
  projenrcTs: true,
  packageManager: NodePackageManager.NPM,

  deps: ['cdk-nag', '@aws-cdk/aws-eks-v2-alpha', '@aws-cdk/lambda-layer-kubectl-v33', '@aws-cdk/lambda-layer-kubectl-v34'], /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});

// Update the synth task to accept arguments
project.removeTask('synth');
project.addTask('synth', {
  description: 'Synthesizes your cdk app into cdk.out',
  exec: 'cdk synth',
  receiveArgs: true,
});

project.synth();