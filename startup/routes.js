const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors')
const user = require('../routes/users');
const auth = require('../routes/auth')

module.exports = (app) => {
    app.use(cors());
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/user', user);
    app.use('/api/auth', auth);
}