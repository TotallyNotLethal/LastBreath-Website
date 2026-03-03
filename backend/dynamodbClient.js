const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { awsCredentialsProvider } = require('@vercel/functions/oidc');

const AWS_REGION = process.env.players_AWS_REGION || process.env.AWS_REGION || process.env.aws_region || '';
const AWS_ROLE_ARN = process.env.AWS_ROLE_ARN || process.env.players_AWS_ROLE_ARN || '';

const hasRegion = Boolean(AWS_REGION);

let client = null;
let docClient = null;

if (hasRegion) {
  const clientConfig = {
    region: AWS_REGION
  };

  if (AWS_ROLE_ARN) {
    clientConfig.credentials = awsCredentialsProvider({
      roleArn: AWS_ROLE_ARN,
      clientConfig: { region: AWS_REGION }
    });
  }

  client = new DynamoDBClient(clientConfig);
  docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true
    }
  });
}

module.exports = {
  docClient,
  client,
  AWS_REGION,
  AWS_ROLE_ARN
};
