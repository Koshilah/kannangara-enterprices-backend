const mongoose = require("mongoose");

module.exports = (uri = process.env.MONGODB_URI, options = {}) => {
  return mongoose.connect(uri, options).then(() => {
    console.log("Connected to mongoDB!");
  });
};
