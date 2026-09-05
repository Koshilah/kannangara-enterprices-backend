const express = require('express');
const app = express();

require('dotenv').config();

app.get('/', (req,res) => {
    res.send("Hello World!...");
})

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server running on port",PORT);
})

require('./startup/db')();
require('./startup/routes')(app);