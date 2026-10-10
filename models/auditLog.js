const mongoose = require("mongoose");

const auditChangeSchema = new mongoose.Schema(
  {
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false, strict: false },
);

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    userRole: {
      type: String,
      enum: ["admin", "manager", "cashier", "user", "anonymous"],
      default: "anonymous",
      required: true,
    },
    action: { type: String, required: true, trim: true },
    targetResource: { type: String, required: true, trim: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    changes: { type: auditChangeSchema, default: undefined },
    ipAddress: { type: String, trim: true, default: "" },
    userAgent: { type: String, trim: true, default: "" },
    method: { type: String, required: true, trim: true },
    path: { type: String, required: true, trim: true },
    statusCode: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
  },
  { versionKey: false },
);

auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ timestamp: 1, _id: 1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ targetResource: 1, targetId: 1, timestamp: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
