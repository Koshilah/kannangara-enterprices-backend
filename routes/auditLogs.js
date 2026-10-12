const express = require("express");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const PDFDocument = require("pdfkit");
const AuditLog = require("../models/auditLog");
const { User } = require("../models/user");
const auth = require("../middleware/auth");
const mannager = require("../middleware/manager");

const route = express.Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RETENTION_DAYS = 180;

function parseDate(value, endOfDay = false) {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(
    `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`,
  );
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value.toHexString === "function") return value.toHexString();
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function contentDisposition(filename) {
  return `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`;
}

function getDateRange(startDate, endDate) {
  const now = new Date();
  const defaultStart = new Date(
    now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
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

const COMPANY_NAME = "Kannangara Enterprises";
const COMPANY_ADDRESS = "Nonagama Road, Kuttigala, Ambilipitiya";
const COMPANY_CONTACT =
  "Tel: 0472262591 / 0705806000 | Email: kannangaraenterprises@gmail.com";
const LOGO_PATH = path.resolve(__dirname, "../../frontend/public/logo.png");
const DEFAULT_LOGO_URL =
  "https://kannangara-enterprices-6483.onrender.com/logo.png";
const LOGO_FETCH_TIMEOUT_MS = 2500;
let logoCache;

async function loadLogo() {
  const logoUrl = process.env.AUDIT_REPORT_LOGO_URL || DEFAULT_LOGO_URL;
  if (logoCache?.url === logoUrl) return logoCache.promise;

  const promise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        LOGO_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetch(logoUrl, { signal: controller.signal });
        if (response.ok) return Buffer.from(await response.arrayBuffer());
      } finally {
        clearTimeout(timeout);
      }
    } catch (_error) {
      // Fall back to the local asset when the deployed asset is unavailable.
    }

    try {
      return await fs.promises.readFile(LOGO_PATH);
    } catch (_error) {
      return null;
    }
  })();

  logoCache = { url: logoUrl, promise };
  return promise;
}

function displayDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-LK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function displayDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-LK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function userLabel(user) {
  if (!user) return "Unknown employee";
  return `${user.name || "Unknown employee"}${user.email ? ` (${user.email})` : ""}`;
}

function isFailedAction(log) {
  return Number(log.statusCode) >= 400 || /_FAILED$/.test(log.action || "");
}

function drawPdfHeader(
  document,
  generatedBy,
  employeeLabel,
  range,
  logoBuffer,
) {
  const left = 36;
  const right = 559;
  const logoSize = 48;
  const hasLogo = Boolean(logoBuffer);

  if (hasLogo)
    document.image(logoBuffer, left, 34, { fit: [logoSize, logoSize] });

  const textLeft = hasLogo ? left + logoSize + 12 : left;
  document
    .fillColor("#122e4a")
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(COMPANY_NAME, textLeft, 37);
  document
    .fillColor("#505a64")
    .font("Helvetica")
    .fontSize(8.5)
    .text(COMPANY_ADDRESS, textLeft, 61);
  document.text(COMPANY_CONTACT, textLeft, 74);

  document
    .fillColor("#122e4a")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("EMPLOYEE ACTION REPORT", right - 220, 39, {
      width: 220,
      align: "right",
    });
  document
    .fillColor("#5a646e")
    .font("Helvetica")
    .fontSize(8)
    .text(`Generated: ${displayDateTime(new Date())}`, right - 220, 59, {
      width: 220,
      align: "right",
    });
  document.text(`Generated by: ${generatedBy}`, right - 220, 71, {
    width: 220,
    align: "right",
  });

  document
    .strokeColor("#d2d7dc")
    .lineWidth(0.7)
    .moveTo(left, 96)
    .lineTo(right, 96)
    .stroke();
  document
    .fillColor("#122e4a")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`Employee: ${employeeLabel}`, left, 108, { width: 523 });
  document
    .fillColor("#5a646e")
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Reporting period: ${displayDate(range.start)} - ${displayDate(range.end)}`,
      left,
      122,
      { width: 523 },
    );
}

function drawSummaryCard(document, x, y, width, label, value, color) {
  document.roundedRect(x, y, width, 42, 4).fill(color);
  document
    .fillColor("#ffffff")
    .font("Helvetica")
    .fontSize(7)
    .text(label.toUpperCase(), x + 9, y + 9, { width: width - 18 });
  document
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(String(value), x + 9, y + 23, {
      width: width - 18,
      height: 15,
      ellipsis: true,
    });
}

function drawTableHeader(document, y, columns) {
  document.fillColor("#ebf0f5").rect(36, y, 523, 24).fill();
  document.fillColor("#122e4a").font("Helvetica-Bold").fontSize(7.5);
  columns.forEach((column) =>
    document.text(column.label, column.x, y + 8, {
      width: column.width,
      align: column.align || "left",
    }),
  );
}

route.get("/export", [auth, mannager], async (req, res) => {
  const { userId, startDate, endDate, format = "pdf" } = req.query;
  if (!["csv", "pdf"].includes(format)) {
    return res
      .status(400)
      .send({ success: false, message: "Unsupported export format." });
  }

  const filters = getQuery({ userId, startDate, endDate });
  if (!filters) {
    return res
      .status(400)
      .send({ success: false, message: "Invalid audit log filters." });
  }

  const cursor = AuditLog.find(filters.query)
    .sort({ timestamp: 1, _id: 1 })
    .lean()
    .cursor();
  const filename = `employee-actions-${new Date().toISOString().slice(0, 10)}.${format}`;

  res.setHeader("Content-Disposition", contentDisposition(filename));
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.write(
      "timestamp,userId,userRole,action,targetResource,targetId,ipAddress,userAgent,method,path,statusCode,changes\r\n",
    );
    try {
      for await (const log of cursor) {
        res.write(
          [
            log.timestamp?.toISOString(),
            log.userId,
            log.userRole,
            log.action,
            log.targetResource,
            log.targetId,
            log.ipAddress,
            log.userAgent,
            log.method,
            log.path,
            log.statusCode,
            log.changes,
          ]
            .map(csvValue)
            .join(",") + "\r\n",
        );
      }
      return res.end();
    } catch (error) {
      if (!res.headersSent)
        return res
          .status(500)
          .send({ success: false, message: "Unable to export audit logs." });
      return res.end();
    } finally {
      await cursor.close();
    }
  }

  try {
    const logs = [];
    for await (const log of cursor) {
      logs.push(log);
    }

    const employeeIds = logs.map((log) => log.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: employeeIds } })
      .select("name email")
      .lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const selectedEmployee = userId
      ? await User.findById(userId).select("name email").lean()
      : null;
    const manager = await User.findById(req.user?._id || req.user?.id)
      .select("name email")
      .lean();
    const logoBuffer = await loadLogo();
    const generatedBy =
      userLabel(manager) === "Unknown employee"
        ? req.user?.email || req.user?.name || "Manager"
        : userLabel(manager);
    const employeeLabel = selectedEmployee
      ? userLabel(selectedEmployee)
      : "All employees";
    const failedCount = logs.filter(isFailedAction).length;
    const columns = [
      { label: "#", x: 36, width: 20, align: "center" },
      { label: "Date & time", x: 61, width: 72 },
      { label: "Employee", x: 136, width: 96 },
      { label: "Action", x: 235, width: 78 },
      { label: "Resource", x: 316, width: 69 },
      { label: "Target", x: 388, width: 76 },
      { label: "Outcome", x: 467, width: 92, align: "center" },
    ];

    res.setHeader("Content-Type", "application/pdf");
    const document = new PDFDocument({
      size: "A4",
      margin: 36,
      compress: false,
    });
    document.pipe(res);
    drawPdfHeader(
      document,
      generatedBy,
      employeeLabel,
      filters.range,
      logoBuffer,
    );

    const cardY = 143;
    const cardWidth = 124;
    drawSummaryCard(
      document,
      36,
      cardY,
      cardWidth,
      "Total actions",
      logs.length,
      "#122e4a",
    );
    drawSummaryCard(
      document,
      169,
      cardY,
      cardWidth,
      "Successful",
      logs.length - failedCount,
      "#108c5f",
    );
    drawSummaryCard(
      document,
      302,
      cardY,
      cardWidth,
      "Failed",
      failedCount,
      "#dc2626",
    );
    drawSummaryCard(
      document,
      435,
      cardY,
      cardWidth,
      "Selected period",
      `${displayDate(filters.range.start)} - ${displayDate(filters.range.end)}`,
      "#2563eb",
    );

    document
      .fillColor("#122e4a")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Action details", 36, 203);
    document
      .fillColor("#78828c")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `${logs.length} action${logs.length === 1 ? "" : "s"} included`,
        117,
        205,
      );

    let currentY = 220;
    drawTableHeader(document, currentY, columns);
    currentY += 24;
    document.font("Helvetica").fontSize(7).fillColor("#2d3741");

    const rowHeight = 27;
    if (logs.length === 0) {
      document
        .strokeColor("#e6ebf0")
        .rect(36, currentY, 523, rowHeight)
        .stroke();
      document.text(
        "No actions found for the selected period.",
        45,
        currentY + 10,
        { width: 505, align: "center" },
      );
    }

    logs.forEach((log, index) => {
      if (currentY + rowHeight > 790) {
        document.addPage();
        drawTableHeader(document, 36, columns);
        currentY = 60;
      }

      if (index % 2 === 1)
        document.fillColor("#f4f7fa").rect(36, currentY, 523, rowHeight).fill();
      document.fillColor("#2d3741").font("Helvetica").fontSize(7);
      const employee = usersById.get(String(log.userId));
      const outcome = isFailedAction(log) ? "Failed" : "Success";
      const values = [
        String(index + 1),
        displayDateTime(log.timestamp),
        userLabel(employee),
        log.action || "-",
        log.targetResource || "-",
        log.targetId || "-",
        outcome,
      ];
      columns.forEach((column, columnIndex) => {
        document.fillColor(
          columnIndex === 6
            ? outcome === "Failed"
              ? "#dc2626"
              : "#108c5f"
            : "#2d3741",
        );
        document
          .font(columnIndex === 6 ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7)
          .text(values[columnIndex], column.x, currentY + 9, {
            width: column.width,
            height: 18,
            ellipsis: true,
            align: column.align || "left",
          });
      });
      document
        .strokeColor("#e6ebf0")
        .lineWidth(0.25)
        .moveTo(36, currentY + rowHeight)
        .lineTo(559, currentY + rowHeight)
        .stroke();
      currentY += rowHeight;
    });

    document.end();
  } catch (error) {
    if (!res.headersSent)
      return res
        .status(500)
        .send({ success: false, message: "Unable to export audit logs." });
  } finally {
    await cursor.close();
  }
});

module.exports = route;
