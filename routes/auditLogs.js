const express = require("express");
const mongoose = require("mongoose");
const PDFDocument = require("pdfkit");
const AuditLog = require("../models/auditLog");
const auth = require("../middleware/auth");
const mannager = require("../middleware/manager");

const route = express.Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RETENTION_DAYS = 180;

function parseDate(value, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value.toHexString === "function") return value.toHexString();
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function contentDisposition(filename) {
  return `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`;
}

function getDateRange(startDate, endDate) {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const start = startDate ? parseDate(startDate) : defaultStart;
  const end = endDate ? parseDate(endDate, true) : now;
  if ((startDate && !start) || (endDate && !end) || start > end) return null;
  return { start, end };
}

function getQuery({ userId, startDate, endDate }) {
  const range = getDateRange(startDate, endDate);
  if (!range) return null;
  const query = { timestamp: { $gte: range.start, $lte: range.end } };
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) return null;
    query.userId = new mongoose.Types.ObjectId(userId);
  }
  return { query, range };
}

route.get("/export", [auth, mannager], async (req, res) => {
  const { userId, startDate, endDate, format = "pdf" } = req.query;
  if (!["csv", "pdf"].includes(format)) {
    return res.status(400).send({ success: false, message: "Unsupported export format." });
  }

  const filters = getQuery({ userId, startDate, endDate });
  if (!filters) {
    return res.status(400).send({ success: false, message: "Invalid audit log filters." });
  }

  const cursor = AuditLog.find(filters.query).sort({ timestamp: 1, _id: 1 }).lean().cursor();
  const filename = `employee-actions-${new Date().toISOString().slice(0, 10)}.${format}`;

  res.setHeader("Content-Disposition", contentDisposition(filename));
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.write("timestamp,userId,userRole,action,targetResource,targetId,ipAddress,userAgent,method,path,statusCode,changes\r\n");
    try {
      for await (const log of cursor) {
        res.write([
          log.timestamp?.toISOString(), log.userId, log.userRole, log.action,
          log.targetResource, log.targetId, log.ipAddress, log.userAgent,
          log.method, log.path, log.statusCode, log.changes,
        ].map(csvValue).join(",") + "\r\n");
      }
      return res.end();
    } catch (error) {
      if (!res.headersSent) return res.status(500).send({ success: false, message: "Unable to export audit logs." });
      return res.end();
    } finally {
      await cursor.close();
    }
  }

  res.setHeader("Content-Type", "application/pdf");
  const document = new PDFDocument({ margin: 40 });
  document.pipe(res);
  document.fontSize(18).text("Employee Action Report").moveDown(0.5);
  document.fontSize(10).text(`From: ${filters.range.start.toISOString()}`);
  document.text(`To: ${filters.range.end.toISOString()}`);
  document.text(`Employee: ${userId || "All employees"}`).moveDown();

  let count = 0;
  try {
    for await (const log of cursor) {
      count += 1;
      document.fontSize(9).text(`${log.timestamp?.toISOString() || ""} | ${log.userRole || ""} | ${log.action || ""} | ${log.targetResource || ""} | ${log.method || ""} ${log.path || ""} | Status ${log.statusCode ?? ""}`);
    }
    document.moveDown().fontSize(10).text(`Total actions: ${count}`);
    document.end();
  } catch (error) {
    document.end();
  } finally {
    await cursor.close();
  }
});

module.exports = route;