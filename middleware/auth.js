const jwt = require('jsonwebtoken');

module.exports = function (req, res, next){
    const authHeader = req.headers.authorization || '';
    const [scheme, accessToken] = authHeader.split(' ');

    if(scheme !== 'Bearer' || !accessToken)
        return res.status(401).send({success: false, message: 'Access Denied. No token Provided!'});

    //const accessToken = req.header('x-auth-token');
    //if(!accessToken) return res.status(401).send({success: false, message: 'Access Denied. No token Provided!'})

    try {
        const decoded = jwt.verify(accessToken, process.env.JWT_PRIVATE_KEY);
        req.user = decoded;
        next();
    } catch (error) {
        const msg = error.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid token';
        res.status(400).send({success: false, message: msg});
    }
}