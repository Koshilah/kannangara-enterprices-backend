module.exports = function(req,res,next){
    if(!req.user.isCashier) return res.status(403).send({success: false, message: "Access Denied!."});

    next();
}