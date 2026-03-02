const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const docClient = DynamoDBDocumentClient.from(ddbClient);

const PROFILES_TABLE = process.env.DYNAMODB_PROFILES_TABLE || "NovaTryOnMe_UserProfiles";
const FAVORITES_TABLE = process.env.DYNAMODB_FAVORITES_TABLE || "NovaTryOnMe_Favorites";
const VIDEOS_TABLE = process.env.DYNAMODB_VIDEOS_TABLE || "NovaTryOnMe_Videos";

// --- Profiles ---

async function getProfile(userId) {
  const result = await docClient.send(new GetCommand({
    TableName: PROFILES_TABLE,
    Key: { userId },
  }));
  return result.Item || null;
}

async function putProfile(userId, data) {
  const item = {
    userId,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  if (!data.createdAt) {
    item.createdAt = new Date().toISOString();
  }
  await docClient.send(new PutCommand({
    TableName: PROFILES_TABLE,
    Item: item,
  }));
  return item;
}

// --- Favorites ---

async function getFavorites(userId) {
  const result = await docClient.send(new QueryCommand({
    TableName: FAVORITES_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": userId },
  }));
  return result.Items || [];
}

async function addFavorite(userId, favoriteData) {
  const item = {
    userId,
    asin: favoriteData.asin,
    productTitle: favoriteData.productTitle,
    productImage: favoriteData.productImage,
    category: favoriteData.category || "",
    garmentClass: favoriteData.garmentClass || "",
    tryOnResultKey: favoriteData.tryOnResultKey || "",
    outfitId: favoriteData.outfitId || "",
    savedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({
    TableName: FAVORITES_TABLE,
    Item: item,
  }));
  return item;
}

async function removeFavorite(userId, asin) {
  await docClient.send(new DeleteCommand({
    TableName: FAVORITES_TABLE,
    Key: { userId, asin },
  }));
  return { removed: true };
}

async function isFavorite(userId, asin) {
  const result = await docClient.send(new GetCommand({
    TableName: FAVORITES_TABLE,
    Key: { userId, asin },
  }));
  return !!result.Item;
}

// --- Videos ---

async function getUserVideos(userId) {
  const result = await docClient.send(new QueryCommand({
    TableName: VIDEOS_TABLE,
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: { ":uid": userId },
  }));
  return result.Items || [];
}

async function saveVideoRecord(userId, videoData) {
  const item = {
    userId,
    videoId: videoData.videoId,
    videoKey: videoData.videoKey,
    asin: videoData.asin || "",
    productTitle: videoData.productTitle || "",
    productImage: videoData.productImage || "",
    savedAt: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({
    TableName: VIDEOS_TABLE,
    Item: item,
  }));
  return item;
}

async function removeVideo(userId, videoId) {
  await docClient.send(new DeleteCommand({
    TableName: VIDEOS_TABLE,
    Key: { userId, videoId },
  }));
  return { removed: true };
}

module.exports = { getProfile, putProfile, getFavorites, addFavorite, removeFavorite, isFavorite, getUserVideos, saveVideoRecord, removeVideo };
