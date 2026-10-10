const { auditRequest, getUserRole } = require("../utils/auditLogger");

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ADMIN_ROLES = new Set(["admin", "manager", "cashier"]);

function getTargetResource(req) {
  const segments = (req.baseUrl || req.originalUrl || "")
    .split("/")
    .filter(Boolean);
  const resource = segments[1] || segments[0];
  return resource ? resource.replace(/s$/, "").replace(/-/g, " ") : "Request";
}

function getTargetId(req) {
  const params = req.params || {};
  return (
    params.id || params.orderID || params.deliveryId || params.expenseId || null
  );
}

module.exports = function auditMiddleware(req, res, next) {
  res.once("finish", () => {
    if (
      req.auditLogged ||
      !MUTATION_METHODS.has(req.method) ||
      res.statusCode >= 400 ||
      !ADMIN_ROLES.has(getUserRole(req.user))
    ) {
      return;
    }

    auditRequest(req, res, {
      targetResource: getTargetResource(req),
      targetId: getTargetId(req),
    });
  });

  next();
};
