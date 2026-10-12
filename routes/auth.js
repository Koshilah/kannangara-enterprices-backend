const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const route = express.Router();
const { User } = require("../models/user");
const {
  generateTokenHash,
  signAccessToken,
  signRefreshToken,
  createJti,
  persistRefreshToken,
  setRefreshCookie,
  rotateRefreshToken,
} = require("../utils/tokens");
const RefreshToken = require("../models/refreshToken");
const { auditRequest, getUserRole } = require("../utils/auditLogger");

const LOGIN_AUDIT_ROLES = new Set(["cashier", "admin", "manager"]);

const emailValidationSchema = Joi.string().email().min(6).max(50).required();
const passwordValidationSchema = Joi.string()
  .pattern(new RegExp(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/))
  .required();

function clearRefreshCookies(res) {
  ["/", "/api/auth", "/api/auth/refresh"].forEach((path) => {
    res.clearCookie("refresh_token", { path });
  });
}

function clearLegacyRefreshCookies(res) {
  ["/api/auth", "/api/auth/refresh"].forEach((path) => {
    res.clearCookie("refresh_token", { path });
  });
}

function sendLoginFailure(
  req,
  res,
  reason,
  message = "Invalid email or password",
) {
  auditRequest(req, res, {
    action: "LOGIN_FAILED",
    targetResource: "Authentication",
    changes: { after: { reason } },
  });
  return res.status(400).send({ success: false, message });
}

function findUserByEmail(email) {
  const normalizedEmail = (email || "").trim();
  const escaped = normalizedEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  return User.findOne({
    $or: [
      { email: normalizedEmail },
      { email: { $regex: new RegExp(`^${escaped}$`, "i") } },
    ],
  });
}

route.post("/", async (req, res) => {
  if (!req.body.email || !req.body.password)
    return sendLoginFailure(
      req,
      res,
      "missing_credentials",
      "Provide both email and password!",
    );

  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) return sendLoginFailure(req, res, "invalid_credentials");

    const isPasswordMatch = await bcrypt.compare(
      req.body.password,
      user.password,
    );

    if (!isPasswordMatch)
      return sendLoginFailure(req, res, "invalid_credentials");

    const accessToken = signAccessToken(user);
    const jti = createJti();
    const refreshToken = signRefreshToken(user, jti);

    await persistRefreshToken({
      user,
      refreshToken,
      jti,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
    });

    setRefreshCookie(res, refreshToken);
    // Remove cookies created by previous versions after setting the current
    // cookie, so clients that select the first Set-Cookie value use the valid
    // token.
    clearLegacyRefreshCookies(res);

    const userRole = getUserRole(user);
    if (LOGIN_AUDIT_ROLES.has(userRole)) {
      auditRequest(req, res, {
        action: "LOGIN_SUCCEEDED",
        targetResource: "Authentication",
        userId: user._id,
        userRole,
      });
    }

    res.header("x-auth-token", accessToken).send(accessToken);
  } catch (error) {
    auditRequest(req, res, {
      action: "LOGIN_FAILED",
      targetResource: "Authentication",
      changes: { after: { reason: "server_error" } },
    });
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.post("/verify-email", async (req, res) => {
  const { email } = req.body;
  const { error } = emailValidationSchema.validate(email);
  if (!email || error) {
    return res
      .status(400)
      .send({ success: false, message: "Provide a valid email address!" });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res
        .status(404)
        .send({ success: false, message: "No account found with this email!" });
    }

    res.send({ success: true, message: "Email verified successfully." });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occurred: " + error });
  }
});

route.post("/reset-password", async (req, res) => {
  const { email, password } = req.body;
  const emailError = emailValidationSchema.validate(email).error;
  if (!email || emailError) {
    return res
      .status(400)
      .send({ success: false, message: "Provide a valid email address!" });
  }

  const passwordError = passwordValidationSchema.validate(password).error;
  if (!password || passwordError) {
    return res.status(400).send({
      success: false,
      message:
        "Use a valid password with at least 8 characters, including uppercase, lowercase, number, and symbol.",
    });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res
        .status(404)
        .send({ success: false, message: "User not found!" });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    await RefreshToken.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

    res.send({ success: true, message: "Password updated successfully." });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occurred: " + error });
  }
});

route.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken)
      return res
        .status(401)
        .send({ success: false, message: "No Refresh Token" });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (error) {
      return res
        .status(401)
        .send({ success: false, message: "Invalid or expired refresh token" });
    }

    const tokenHash = generateTokenHash(refreshToken);
    const doc = await RefreshToken.findOne({
      tokenHash,
      jti: decoded.jti,
    }).populate("user");

    if (!doc) {
      return res
        .status(401)
        .send({ success: false, message: "Refresh token not recognized" });
    }
    if (doc.revokedAt) {
      return res
        .status(401)
        .send({ success: false, message: "Refresh token revoked" });
    }
    if (doc.expiresAt < new Date()) {
      return res
        .status(401)
        .send({ success: false, message: "Refresh token expired" });
    }

    const newAccess = await rotateRefreshToken(doc, doc.user, req, res);

    res.header("x-auth-token", newAccess).send(newAccess);
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.post("/logout", async (req, res) => {
  try {
    const token = req.cookies?.refresh_token;
    if (token) {
      const tokenHash = generateTokenHash(token);
      const doc = await RefreshToken.findOne({ tokenHash });
      if (doc && !doc.revokedAt) {
        doc.revokedAt = new Date();
        await doc.save();
      }
    }
    clearRefreshCookies(res);
    res.json({ success: true, message: "Logged out" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" + error });
  }
});

module.exports = route;
