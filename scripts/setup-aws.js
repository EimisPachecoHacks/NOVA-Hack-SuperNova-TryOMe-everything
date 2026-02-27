/**
 * NovaTryOnMe - AWS Resource Setup Script
 *
 * Creates Cognito User Pool, DynamoDB tables, and S3 bucket.
 * Run once: node scripts/setup-aws.js
 *
 * Reads credentials from backend/.env
 */

const path = require("path");

// Resolve modules from backend/node_modules
module.paths.unshift(path.join(__dirname, "../backend/node_modules"));

require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });

const {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} = require("@aws-sdk/client-dynamodb");

const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");

const REGION = process.env.AWS_REGION || "us-east-1";
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
};

const cognitoClient = new CognitoIdentityProviderClient({ region: REGION, credentials });
const ddbClient = new DynamoDBClient({ region: REGION, credentials });
const s3Client = new S3Client({ region: REGION, credentials });

async function createCognitoUserPool() {
  console.log("\n=== Creating Cognito User Pool ===");

  try {
    const poolResult = await cognitoClient.send(new CreateUserPoolCommand({
      PoolName: "NovaTryOnMe_Users",
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: false,
        },
      },
      AutoVerifiedAttributes: ["email"],
      UsernameAttributes: ["email"],
      Schema: [
        {
          Name: "email",
          AttributeDataType: "String",
          Required: true,
          Mutable: true,
        },
      ],
    }));

    const poolId = poolResult.UserPool.Id;
    console.log(`User Pool created: ${poolId}`);

    // Create App Client
    const clientResult = await cognitoClient.send(new CreateUserPoolClientCommand({
      UserPoolId: poolId,
      ClientName: "NovaTryOnMe_Extension",
      GenerateSecret: false,
      ExplicitAuthFlows: [
        "ALLOW_USER_PASSWORD_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH",
        "ALLOW_USER_SRP_AUTH",
      ],
    }));

    const clientId = clientResult.UserPoolClient.ClientId;
    console.log(`App Client created: ${clientId}`);
    console.log(`\nAdd to backend/.env:`);
    console.log(`COGNITO_USER_POOL_ID=${poolId}`);
    console.log(`COGNITO_CLIENT_ID=${clientId}`);
    console.log(`COGNITO_REGION=${REGION}`);

    return { poolId, clientId };
  } catch (error) {
    console.error("Cognito setup error:", error.message);
    throw error;
  }
}

async function createDynamoDBTable(tableName, partitionKey, sortKey) {
  console.log(`\n=== Creating DynamoDB Table: ${tableName} ===`);

  try {
    // Check if table exists
    await ddbClient.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table ${tableName} already exists, skipping.`);
    return;
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }

  const keySchema = [{ AttributeName: partitionKey, KeyType: "HASH" }];
  const attrDefs = [{ AttributeName: partitionKey, AttributeType: "S" }];

  if (sortKey) {
    keySchema.push({ AttributeName: sortKey, KeyType: "RANGE" });
    attrDefs.push({ AttributeName: sortKey, AttributeType: "S" });
  }

  await ddbClient.send(new CreateTableCommand({
    TableName: tableName,
    KeySchema: keySchema,
    AttributeDefinitions: attrDefs,
    BillingMode: "PAY_PER_REQUEST",
  }));

  console.log(`Table ${tableName} created successfully.`);
}

async function createS3Bucket(bucketName) {
  console.log(`\n=== Creating S3 Bucket: ${bucketName} ===`);

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`Bucket ${bucketName} already exists, skipping.`);
    return;
  } catch (err) {
    if (err.name !== "NotFound" && err.$metadata?.httpStatusCode !== 404) {
      // Bucket might exist but we don't have access, or other error
      if (err.$metadata?.httpStatusCode !== 403) throw err;
      console.log(`Bucket ${bucketName} may already exist (access denied). Skipping.`);
      return;
    }
  }

  const params = { Bucket: bucketName };
  if (REGION !== "us-east-1") {
    params.CreateBucketConfiguration = { LocationConstraint: REGION };
  }

  await s3Client.send(new CreateBucketCommand(params));
  console.log(`Bucket ${bucketName} created successfully.`);
}

async function main() {
  console.log("NovaTryOnMe - AWS Resource Setup");
  console.log(`Region: ${REGION}`);

  try {
    // 1. Cognito
    const { poolId, clientId } = await createCognitoUserPool();

    // 2. DynamoDB
    await createDynamoDBTable("NovaTryOnMe_UserProfiles", "userId");
    await createDynamoDBTable("NovaTryOnMe_Favorites", "userId", "asin");

    // 3. S3
    await createS3Bucket("nova-tryonme-users");

    console.log("\n=== Setup Complete ===");
    console.log("\nDon't forget to add the following to your backend/.env:");
    console.log(`COGNITO_USER_POOL_ID=${poolId}`);
    console.log(`COGNITO_CLIENT_ID=${clientId}`);
    console.log(`COGNITO_REGION=${REGION}`);
    console.log(`S3_USER_BUCKET=nova-tryonme-users`);
    console.log(`DYNAMODB_PROFILES_TABLE=NovaTryOnMe_UserProfiles`);
    console.log(`DYNAMODB_FAVORITES_TABLE=NovaTryOnMe_Favorites`);
  } catch (error) {
    console.error("\nSetup failed:", error.message);
    process.exit(1);
  }
}

main();
