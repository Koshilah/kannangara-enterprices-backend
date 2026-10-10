const AuditLog = require("../models/auditLog");

const SENSITIVE_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "paymentID",
  "paymentToken",
]);

function getUserId(user) {
  return user?.id || user?._id || null;
}

function getUserRole(user) {
  if (!user) return "anonymous";
  if (user.isMannager) return "manager";
  if (user.isAdmin) return "admin";
  if (user.isCashier) return "cashier";
  return "user";
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;
  if (typeof value.toObject === "function") {
    return sanitizeValue(value.toObject({ depopulate: true }));
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, nestedValue]) => {
      if (SENSITIVE_KEYS.has(key)) return [];
      return [[key, sanitizeValue(nestedValue)]];
    }),
  );
}

function getRequestMetadata(req, res) {
  return {
    userId: getUserId(req.user),
    userRole: getUserRole(req.user),
    ipAddress: req.ip || "",
    userAgent: req.get("user-agent") || "",
    method: req.method,
    path: req.originalUrl || req.path,
    statusCode: res.statusCode,
  };
}

function writeAuditLog(event) {
  const sanitizedEvent = {
    ...event,
    changes: event.changes ? sanitizeValue(event.changes) : undefined,
  };

  void AuditLog.create(sanitizedEvent).catch((error) => {
    console.error("Unable to persist audit log", {
      error: error.message,
      action: sanitizedEvent.action,
      targetResource: sanitizedEvent.targetResource,
      targetId: sanitizedEvent.targetId,
    });
  });
}

function auditRequest(req, res, event = {}) {
  req.auditLogged = true;
  const metadata = getRequestMetadata(req, res);

  writeAuditLog({
    ...metadata,
    userId: event.userId ?? metadata.userId,
    userRole: event.userRole ?? metadata.userRole,
    action: event.action || "ADMIN_REQUEST",
    targetResource: event.targetResource || "Request",
    targetId: event.targetId || null,
    changes: event.changes,
  });
}

module.exports = {
  auditRequest,
  getRequestMetadata,
  getUserRole,
  sanitizeValue,
  writeAuditLog,
};
