const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

process.env.NODE_ENV = "test";
process.env.JWT_PRIVATE_KEY =
  process.env.JWT_PRIVATE_KEY || "users-route-test-access-secret";
process.env.REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "users-route-test-refresh-secret";

if (!process.env.MONGODB_TEST_URI) {
  throw new Error("MONGODB_TEST_URI must be set before running backend tests");
}

module.exports = {
  mongodbTestUri: process.env.MONGODB_TEST_URI,
};
