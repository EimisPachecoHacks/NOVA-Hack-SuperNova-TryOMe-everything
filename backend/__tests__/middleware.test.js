/**
 * Unit tests for middleware: validation, CORS, auth
 */

// ── Validation middleware ─────────────────────────────────────────────
const { validateImagePayload } = require("../middleware/validation");

describe("validateImagePayload", () => {
  let req, res, next;
  beforeEach(() => {
    req = { headers: {} };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    next = jest.fn();
  });

  test("allows requests under 50MB", () => {
    req.headers["content-length"] = "1000";
    validateImagePayload(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("rejects requests over 50MB", () => {
    req.headers["content-length"] = String(51 * 1024 * 1024);
    validateImagePayload(req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: "Payload too large. Maximum 50MB." });
    expect(next).not.toHaveBeenCalled();
  });

  test("allows requests with no content-length header", () => {
    validateImagePayload(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("allows exactly 50MB", () => {
    req.headers["content-length"] = String(50 * 1024 * 1024);
    validateImagePayload(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ── CORS middleware ───────────────────────────────────────────────────
const cors = require("cors");
const corsMiddleware = require("../middleware/cors");

describe("CORS middleware", () => {
  let req, res, next;
  beforeEach(() => {
    res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      statusCode: 200,
      getHeader: jest.fn(),
    };
    next = jest.fn();
  });

  test("allows chrome-extension:// origin", (done) => {
    req = { method: "GET", headers: { origin: "chrome-extension://abcdef123456" } };
    corsMiddleware(req, res, (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  test("allows http://localhost origin", (done) => {
    req = { method: "GET", headers: { origin: "http://localhost:3000" } };
    corsMiddleware(req, res, (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  test("allows requests with no origin (server-to-server)", (done) => {
    req = { method: "GET", headers: {} };
    corsMiddleware(req, res, (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  test("rejects external origin", (done) => {
    req = { method: "GET", headers: { origin: "https://evil.example.com" } };
    corsMiddleware(req, res, (err) => {
      expect(err).toBeDefined();
      expect(err.message).toMatch(/CORS/);
      done();
    });
  });
});
