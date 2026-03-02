const cors = require("cors");

const corsMiddleware = cors({
  origin: function (origin, callback) {
    // Allow: chrome extensions, localhost dev, and requests with no origin (e.g. server-to-server)
    if (!origin || origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost")) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
});

module.exports = corsMiddleware;
