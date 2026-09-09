const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const user = require("../routes/users");
const auth = require("../routes/auth");
const cart = require("../routes/cart")

module.exports = (app) => {
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/user", user);
  app.use("/api/auth", auth);
  app.use("/api/cart", cart);
};
