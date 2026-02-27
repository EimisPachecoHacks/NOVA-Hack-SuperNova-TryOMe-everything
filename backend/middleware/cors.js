const cors = require("cors");

const corsMiddleware = cors({
  origin: true,  // Allow all origins (for chrome-extension:// during development)
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
});

module.exports = corsMiddleware;
