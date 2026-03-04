const express = require("express");
const router = express.Router();
const { signUp, confirmSignUp, signIn, refreshTokens, resendCode } = require("../services/cognito");

router.post("/signup", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    const result = await signUp(email, password);
    res.json(result);
  } catch (error) {
    if (error.name === "UsernameExistsException") {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    if (error.name === "InvalidPasswordException") {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

router.post("/confirm", async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: "email and code are required" });
    }
    const result = await confirmSignUp(email, code);
    res.json(result);
  } catch (error) {
    if (error.name === "CodeMismatchException") {
      return res.status(400).json({ error: "Invalid verification code" });
    }
    if (error.name === "ExpiredCodeException") {
      return res.status(400).json({ error: "Verification code has expired" });
    }
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }
    const tokens = await signIn(email, password);
    res.json(tokens);
  } catch (error) {
    if (error.name === "NotAuthorizedException" || error.name === "UserNotFoundException") {
      return res.status(401).json({ error: "Incorrect email or password" });
    }
    if (error.name === "UserNotConfirmedException") {
      return res.status(403).json({ error: "Please verify your email first" });
    }
    next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "refreshToken is required" });
    }
    const tokens = await refreshTokens(refreshToken);
    res.json(tokens);
  } catch (error) {
    next(error);
  }
});

router.post("/resend-code", async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
    const result = await resendCode(email);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
