const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
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

route.post("/", async (req, res) => {
  if (!req.body.email || !req.body.password)
    return res
      .status(400)
      .send({ success: false, message: "Provide both email and password!" });

  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user)
      return res
        .status(400)
        .send({ success: false, message: "Invalid email or password" });

    const isPasswordMatch = await bcrypt.compare(
      req.body.password,
      user.password,
    );

    if (!isPasswordMatch)
      return res
        .status(400)
        .send({ success: false, message: "Invalid email or password" });

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

    res.header("x-auth-token", accessToken).send(accessToken);
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
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


route.post('/logout', async (req, res) => {
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
    res.clearCookie('refresh_token', { path: '/api/auth/refresh' });
    res.json({success: true, message: 'Logged out' });
  } catch (error) {
    res.status(500).json({success:false, message: 'Server error' + error});
  }
})

module.exports = route;
