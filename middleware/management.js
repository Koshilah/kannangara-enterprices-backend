module.exports = function (req, res, next) {
  if (!req.user?.isAdmin && !req.user?.isMannager) {
    return res.status(403).send({
      success: false,
      message: "Access Denied!",
    });
  }

  next();
};
