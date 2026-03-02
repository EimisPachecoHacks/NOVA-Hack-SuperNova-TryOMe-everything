const express = require("express");
const router = express.Router();
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { AdminDeleteUserCommand, CognitoIdentityProviderClient } = require("@aws-sdk/client-cognito-identity-provider");
const { requireAuth } = require("../middleware/auth");
const { getProfile, getFavorites, getUserVideos, removeFavorite, removeVideo } = require("../services/dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const S3_USER_BUCKET = process.env.S3_USER_BUCKET || "nova-tryonme-users";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const PROFILES_TABLE = process.env.DYNAMODB_PROFILES_TABLE || "NovaTryOnMe_UserProfiles";

// DELETE /api/account — Delete the entire user account
router.delete("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId;
    const email = req.userEmail;
    console.log(`[account] DELETE account requested for userId=${userId}, email=${email}`);

    // 1. Delete all S3 objects under users/{userId}/
    const s3Prefix = `users/${userId}/`;
    let continuationToken;
    let deletedS3Count = 0;
    do {
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: S3_USER_BUCKET,
        Prefix: s3Prefix,
        ContinuationToken: continuationToken,
      }));

      if (listResult.Contents && listResult.Contents.length > 0) {
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: S3_USER_BUCKET,
          Delete: {
            Objects: listResult.Contents.map((obj) => ({ Key: obj.Key })),
          },
        }));
        deletedS3Count += listResult.Contents.length;
      }
      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : null;
    } while (continuationToken);

    console.log(`[account] Deleted ${deletedS3Count} S3 objects`);

    // 2. Delete all favorites from DynamoDB
    const favorites = await getFavorites(userId);
    for (const fav of favorites) {
      await removeFavorite(userId, fav.asin);
    }
    console.log(`[account] Deleted ${favorites.length} favorites`);

    // 3. Delete all videos from DynamoDB
    const videos = await getUserVideos(userId);
    for (const vid of videos) {
      await removeVideo(userId, vid.videoId);
    }
    console.log(`[account] Deleted ${videos.length} video records`);

    // 4. Delete profile from DynamoDB
    await docClient.send(new DeleteCommand({
      TableName: PROFILES_TABLE,
      Key: { userId },
    }));
    console.log("[account] Deleted profile record");

    // 5. Delete Cognito user
    if (email) {
      await cognitoClient.send(new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      }));
      console.log("[account] Deleted Cognito user");
    }

    console.log(`[account] Account fully deleted for ${email}`);
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
