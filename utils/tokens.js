const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const RefreshToken = require("../models/refreshToken");

const ACCESS_TTL = "15m";
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

function generateTokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createJti() {
  return crypto.randomBytes(16).toString("hex");
}

function signAccessToken(user) {
  const payload = {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    isMannager: user.isMannager,
    isCashier: user.isCashier,
  };
  return jwt.sign(payload, process.env.JWT_PRIVATE_KEY, {
    expiresIn: ACCESS_TTL,
  });
}

function signRefreshToken(user, jti) {
  const payload = { id: user._id.toString(), jti };
  const token = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TTL_SEC,
  });
  return token;
}

async function persistRefreshToken({ user, refreshToken, jti, ip, userAgent }) {
  const tokenHash = generateTokenHash(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  await RefreshToken.create({
    user: user._id,
    tokenHash,
    jti,
    expiresAt,
    ip,
    userAgent,
  });
}

function setRefreshCookie(res, refreshToken) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: REFRESH_TTL_SEC * 1000,
  });
}

async function rotateRefreshToken(oldDoc, user, req, res) {
  // revoke old
  oldDoc.revokedAt = new Date();
  const newJti = createJti();
  oldDoc.replacedBy = newJti;
  await oldDoc.save();

  // issue new
  const newAccess = signAccessToken(user);
  const newRefresh = signRefreshToken(user, newJti);
  await persistRefreshToken({
    user,
    refreshToken: newRefresh,
    jti: newJti,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || "",
  });
  setRefreshCookie(res, newRefresh);
  return newAccess;
}

module.exports = {
  generateTokenHash,
  createJti,
  signAccessToken,
  signRefreshToken,
  persistRefreshToken,
  setRefreshCookie,
  rotateRefreshToken,
};
