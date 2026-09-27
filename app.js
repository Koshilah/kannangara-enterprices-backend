const express = require("express");
const registerRoutes = require("./startup/routes");

function createApp() {
  const app = express();
  app.get("/", (req, res) => {
    res.send("Hello World!...");
  });
  registerRoutes(app);
  return app;
}

module.exports = createApp();
