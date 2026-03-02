const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

const jwksUri = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`;

const client = jwksClient({
  jwksUri,
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Required auth middleware - rejects if no valid token.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization token required" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, getKey, {
    algorithms: ["RS256"],
    issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
  }, (err, decoded) => {
    if (err || !decoded || !decoded.sub) {
      console.error("[auth] Token verification failed:", err?.message || "missing sub claim");
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.userId = decoded.sub;
    req.userEmail = decoded.email || "";
    next();
  });
}

/**
 * Optional auth middleware - proceeds even without token, but sets req.userId if valid.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, getKey, {
    algorithms: ["RS256"],
    issuer: `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`,
  }, (err, decoded) => {
    if (!err && decoded) {
      req.userId = decoded.sub;
      req.userEmail = decoded.email;
      return next();
    }
    // Token was provided but is expired/invalid → return 401 so client can refresh
    console.error("[auth] optionalAuth token expired/invalid:", err?.message);
    return res.status(401).json({ error: "Token expired" });
  });
}

module.exports = { requireAuth, optionalAuth };
