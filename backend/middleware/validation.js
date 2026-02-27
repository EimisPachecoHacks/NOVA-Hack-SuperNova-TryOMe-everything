function validateImagePayload(req, res, next) {
  const contentLength = parseInt(req.headers["content-length"] || "0");
  if (contentLength > 50 * 1024 * 1024) {  // 50MB limit
    return res.status(413).json({ error: "Payload too large. Maximum 50MB." });
  }
  next();
}

module.exports = { validateImagePayload };
