import { App } from 'aws-cdk-lib';
import { AWS_ACCOUNT_ID, AWS_REGION } from './constants';
import { ExampleStage } from './stages/example';

const env = {
  account: AWS_ACCOUNT_ID,
  region: AWS_REGION,
};

const app = new App();

new ExampleStage(app, 'Example', { env });

app.synth();