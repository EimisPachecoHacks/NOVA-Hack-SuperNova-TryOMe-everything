const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const S3_USER_BUCKET = process.env.S3_USER_BUCKET || "nova-tryonme-users";

async function fetchPhotoFromS3(key) {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: S3_USER_BUCKET,
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("base64");
}

module.exports = { s3Client, S3_USER_BUCKET, fetchPhotoFromS3, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, getSignedUrl };
