require("dotenv").config();
const app = require("./app");
const connectDatabase = require("./startup/db");

const PORT = process.env.PORT || 3000;

connectDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Server running on port", PORT);
    });
  })
  .catch((error) => {
    console.error("Error connecting to mongoDB!", error);
    process.exitCode = 1;
  });
