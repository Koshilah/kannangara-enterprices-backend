const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { mongodbTestUri } = require("./testConfig");
const AuditLog = require("../models/auditLog");
const { Product } = require("../models/product");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");
const { sanitizeValue } = require("../utils/auditLogger");

const validPassword = "Password1!";

async function waitForAudit(query) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const audit = await AuditLog.findOne(query).sort({ timestamp: -1 });
    if (audit) return audit;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

describe("audit trail", () => {
  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, { serverSelectionTimeoutMS: 3000 });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([
      AuditLog.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1)
      await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }, 10000);

  test("records an administrative mutation with actor and request metadata", async () => {
    const user = await User.create({
      name: "Audit Admin",
      email: "audit-admin@example.com",
      password: await bcrypt.hash(validPassword, 10),
      isAdmin: true,
    });

    const response = await request(app)
      .post("/api/product")
      .set("Authorization", `Bearer ${signAccessToken(user)}`)
      .set("User-Agent", "audit-test-agent")
      .send({
        title: "Audited Product",
        description: "A product for audit trail testing",
        category: [],
        price: 10,
        discountPrice: 8,
        totalStock: 5,
        outOfStock: false,
        visibility: true,
      });

    expect(response.status).toBe(201);

    const audit = await waitForAudit({
      action: "PRODUCT_CREATED",
      targetId: response.body.data._id,
    });

    expect(audit).not.toBeNull();
    expect(audit.userId.toString()).toBe(user._id.toString());
    expect(audit.userRole).toBe("admin");
    expect(audit.targetResource).toBe("Product");
    expect(audit.userAgent).toBe("audit-test-agent");
    expect(audit.timestamp).toBeInstanceOf(Date);
  });

  test("redacts sensitive values before persistence", () => {
    expect(
      sanitizeValue({
        password: "secret",
        nested: { accessToken: "token", safe: true },
      }),
    ).toEqual({ nested: { safe: true } });
  });
});
