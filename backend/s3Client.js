const { S3Client } = require('@aws-sdk/client-s3');
const { awsCredentialsProvider } = require('@vercel/functions/oidc');

const AWS_REGION = process.env.ITEMS_AWS_REGION || process.env.AWS_REGION || process.env.aws_region || '';
const AWS_ROLE_ARN = process.env.AWS_ROLE_ARN || process.env.items_AWS_ROLE_ARN || '';
const ITEM_IMAGES_BUCKET = process.env.ITEM_IMAGES_BUCKET || process.env.items_BUCKET || '';
const ITEM_IMAGES_PREFIX = (process.env.ITEM_IMAGES_PREFIX || 'custom-items/').replace(/^\/+/, '');
const ITEM_IMAGES_CDN_BASE_URL = (process.env.ITEM_IMAGES_CDN_BASE_URL || '').replace(/\/$/, '');

let client = null;

if (AWS_REGION && ITEM_IMAGES_BUCKET) {
  const clientConfig = { region: AWS_REGION };

  if (AWS_ROLE_ARN) {
    clientConfig.credentials = awsCredentialsProvider({
      roleArn: AWS_ROLE_ARN,
      clientConfig: { region: AWS_REGION }
    });
  }

  client = new S3Client(clientConfig);
}

const buildPublicImageUrl = (objectKey) => {
  if (ITEM_IMAGES_CDN_BASE_URL) {
    return `${ITEM_IMAGES_CDN_BASE_URL}/${objectKey}`;
  }

  return `https://${ITEM_IMAGES_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${objectKey}`;
};

module.exports = {
  client,
  AWS_REGION,
  ITEM_IMAGES_BUCKET,
  ITEM_IMAGES_PREFIX,
  buildPublicImageUrl
};
