const mongoose = require("mongoose");

module.exports = () => {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
      console.log("Connected to mongoDB!");
    })
    .catch(() => {
      console.error("Error connecting to mongoDB!");
    });
};