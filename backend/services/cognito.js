const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

async function signUp(email, password) {
  const command = new SignUpCommand({
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });
  const result = await cognitoClient.send(command);
  return { userSub: result.UserSub, confirmed: result.UserConfirmed };
}

async function confirmSignUp(email, code) {
  const command = new ConfirmSignUpCommand({
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
  });
  await cognitoClient.send(command);
  return { confirmed: true };
}

async function signIn(email, password) {
  const command = new InitiateAuthCommand({
    ClientId: CLIENT_ID,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });
  const result = await cognitoClient.send(command);
  const auth = result.AuthenticationResult;
  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn,
  };
}

async function refreshTokens(refreshToken) {
  const command = new InitiateAuthCommand({
    ClientId: CLIENT_ID,
    AuthFlow: "REFRESH_TOKEN_AUTH",
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });
  const result = await cognitoClient.send(command);
  const auth = result.AuthenticationResult;
  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    expiresIn: auth.ExpiresIn,
  };
}

async function resendCode(email) {
  const command = new ResendConfirmationCodeCommand({
    ClientId: CLIENT_ID,
    Username: email,
  });
  await cognitoClient.send(command);
  return { sent: true };
}

module.exports = { signUp, confirmSignUp, signIn, refreshTokens, resendCode };
