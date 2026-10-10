const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { mongodbTestUri } = require("./testConfig");
const AuditLog = require("../models/auditLog");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const password = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: overrides.name || "Report User",
    email: overrides.email || `${new mongoose.Types.ObjectId()}@example.com`,
    password: await bcrypt.hash(password, 10),
    ...overrides,
  });
}

function authHeader(user) {
  return `Bearer ${signAccessToken(user)}`;
}

function auditEntry(userId, timestamp, overrides = {}) {
  return {
    userId,
    userRole: "cashier",
    action: "PRODUCT_UPDATED",
    targetResource: "Product",
    targetId: new mongoose.Types.ObjectId(),
    ipAddress: "127.0.0.1",
    userAgent: "test-agent",
    method: "PATCH",
    path: "/api/product/1",
    statusCode: 200,
    timestamp,
    ...overrides,
  };
}

describe("audit log export", () => {
  let manager;
  let cashier;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, { serverSelectionTimeoutMS: 3000 });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([AuditLog.deleteMany({}), User.deleteMany({})]);
    manager = await createUser({
      name: "Report Manager",
      isAdmin: true,
      isMannager: true,
      isCashier: true,
    });
    cashier = await createUser({ name: "Report Cashier", isCashier: true });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1)
      await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }, 10000);

  test("requires a manager", async () => {
    await expect(
      request(app).get("/api/audit-logs/export"),
    ).resolves.toMatchObject({ status: 401 });
    const response = await request(app)
      .get("/api/audit-logs/export")
      .set("Authorization", authHeader(cashier));
    expect(response.status).toBe(403);
  });

  test("streams all-user CSV and applies a user filter", async () => {
    await AuditLog.create([
      auditEntry(cashier._id, new Date("2026-10-01T00:00:00.000Z"), {
        changes: { before: { name: "A" }, after: { name: "B, C" } },
      }),
      auditEntry(manager._id, new Date("2026-10-02T00:00:00.000Z"), {
        action: "EMPLOYEE_UPDATED",
      }),
    ]);

    const allResponse = await request(app)
      .get(
        "/api/audit-logs/export?format=csv&startDate=2026-10-01&endDate=2026-10-02",
      )
      .set("Authorization", authHeader(manager));
    expect(allResponse.status).toBe(200);
    expect(allResponse.headers["content-type"]).toMatch(/^text\/csv/);
    expect(allResponse.text).toContain("changes");
    expect(allResponse.text).toContain(
      '"{""before"":{""name"":""A""},""after"":{""name"":""B, C""}}"',
    );
    expect(allResponse.text.indexOf("PRODUCT_UPDATED")).toBeLessThan(
      allResponse.text.indexOf("EMPLOYEE_UPDATED"),
    );

    const userResponse = await request(app)
      .get(`/api/audit-logs/export?format=csv&userId=${cashier._id}`)
      .set("Authorization", authHeader(manager));
    expect(userResponse.status).toBe(200);
    expect(userResponse.text).toContain("PRODUCT_UPDATED");
    expect(userResponse.text).not.toContain("EMPLOYEE_UPDATED");
  });

  test("treats the end date as inclusive", async () => {
    await AuditLog.create([
      auditEntry(cashier._id, new Date("2026-10-03T23:59:59.999Z")),
      auditEntry(cashier._id, new Date("2026-10-04T00:00:00.000Z"), {
        action: "AFTER_RANGE",
      }),
    ]);

    const response = await request(app)
      .get(
        "/api/audit-logs/export?format=csv&startDate=2026-10-03&endDate=2026-10-03",
      )
      .set("Authorization", authHeader(manager));
    expect(response.status).toBe(200);
    expect(response.text).toContain("PRODUCT_UPDATED");
    expect(response.text).not.toContain("AFTER_RANGE");
  });

  test("rejects invalid filters", async () => {
    for (const query of [
      "format=xlsx",
      "userId=not-an-object-id",
      "startDate=2026-02-30",
      "startDate=2026-10-03&endDate=2026-10-02",
    ]) {
      const response = await request(app)
        .get(`/api/audit-logs/export?${query}`)
        .set("Authorization", authHeader(manager));
      expect(response.status).toBe(400);
    }
  });

  test("streams a PDF with a safe download disposition", async () => {
    const response = await request(app)
      .get("/api/audit-logs/export?format=pdf")
      .set("Authorization", authHeader(manager));
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="employee-actions-\d{4}-\d{2}-\d{2}\.pdf"$/,
    );
    expect(response.body.subarray(0, 4).toString()).toBe("%PDF");
  });
});
