/**
 * Unit tests for auth routes — input validation and error handling
 */

jest.mock("../services/cognito", () => ({
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signIn: jest.fn(),
  refreshTokens: jest.fn(),
  resendCode: jest.fn(),
}));

const express = require("express");
const http = require("http");
const { signUp, confirmSignUp, signIn, refreshTokens, resendCode } = require("../services/cognito");

let app, server;

beforeAll((done) => {
  app = express();
  app.use(express.json());
  app.use("/api/auth", require("../routes/auth"));
  app.use((err, req, res, next) => {
    res.status(500).json({ error: "Internal server error" });
  });
  server = http.createServer(app);
  server.listen(0, done);
});

afterAll((done) => {
  server.close(done);
});

function getBaseUrl() {
  return `http://localhost:${server.address().port}`;
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 400 if email missing", async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "Test123!" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("email and password are required");
  });

  test("returns 400 if password missing", async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 409 for existing user", async () => {
    const err = new Error("User already exists");
    err.name = "UsernameExistsException";
    signUp.mockRejectedValue(err);

    const res = await fetch(`${getBaseUrl()}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "existing@example.com", password: "Test123!" }),
    });
    expect(res.status).toBe(409);
  });

  test("returns 400 for invalid password", async () => {
    const err = new Error("Password too short");
    err.name = "InvalidPasswordException";
    signUp.mockRejectedValue(err);

    const res = await fetch(`${getBaseUrl()}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns success on valid signup", async () => {
    signUp.mockResolvedValue({ UserSub: "uuid-123" });

    const res = await fetch(`${getBaseUrl()}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "Test123!" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.UserSub).toBe("uuid-123");
  });
});

describe("POST /api/auth/confirm", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 400 if email or code missing", async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for wrong code", async () => {
    const err = new Error("Code mismatch");
    err.name = "CodeMismatchException";
    confirmSignUp.mockRejectedValue(err);

    const res = await fetch(`${getBaseUrl()}/api/auth/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", code: "000000" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid verification code");
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 400 if email or password missing", async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 401 for wrong password (NotAuthorizedException)", async () => {
    const err = new Error("Incorrect username or password");
    err.name = "NotAuthorizedException";
    signIn.mockRejectedValue(err);

    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "wrong" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Incorrect email or password");
  });

  test("returns 401 for nonexistent user (UserNotFoundException)", async () => {
    const err = new Error("User does not exist");
    err.name = "UserNotFoundException";
    signIn.mockRejectedValue(err);

    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "Test123!" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("Incorrect email or password");
  });

  test("returns 403 for unconfirmed user", async () => {
    const err = new Error("User is not confirmed");
    err.name = "UserNotConfirmedException";
    signIn.mockRejectedValue(err);

    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unconfirmed@example.com", password: "Test123!" }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("verify your email");
  });

  test("returns tokens on successful login", async () => {
    signIn.mockResolvedValue({
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });

    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "Test123!" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.idToken).toBe("id-token");
  });
});

describe("POST /api/auth/refresh", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 400 if refreshToken missing", async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("returns new tokens on valid refresh", async () => {
    refreshTokens.mockResolvedValue({ idToken: "new-id", accessToken: "new-access" });

    const res = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "valid-refresh" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.idToken).toBe("new-id");
  });
});

describe("POST /api/auth/resend-code", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 400 if email missing", async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/resend-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
