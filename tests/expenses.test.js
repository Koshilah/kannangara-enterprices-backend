const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const Expense = require("../models/expense");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Expense Test User",
    email: `expense-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

function expensePayload(overrides = {}) {
  return {
    amount: 125.5,
    shortDescription: "Office supplies",
    category: "utilities",
    date: "2030-01-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("expense routes", () => {
  let adminAuthorization;
  let normalAuthorization;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([Expense.deleteMany({}), User.deleteMany({})]);

    const admin = await createUser({
      email: "expense-admin@example.com",
      isAdmin: true,
    });
    const normalUser = await createUser({ email: "expense-user@example.com" });
    adminAuthorization = authorizationFor(admin);
    normalAuthorization = authorizationFor(normalUser);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  test("requires authentication and admin access", async () => {
    const unauthenticatedResponse = await request(app).get("/api/expense");
    expect(unauthenticatedResponse.status).toBe(401);

    const unauthorizedResponse = await request(app)
      .get("/api/expense")
      .set("Authorization", normalAuthorization);
    expect(unauthorizedResponse.status).toBe(403);
  });

  test("returns expenses sorted by date descending", async () => {
    await Expense.create([
      expensePayload({
        shortDescription: "Older expense",
        date: new Date("2029-01-01"),
      }),
      expensePayload({
        shortDescription: "Newer expense",
        date: new Date("2030-01-01"),
      }),
    ]);

    const response = await request(app)
      .get("/api/expense")
      .set("Authorization", adminAuthorization);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].shortDescription).toBe("Newer expense");
  });

  test("creates an expense with valid data", async () => {
    const response = await request(app)
      .post("/api/expense")
      .set("Authorization", adminAuthorization)
      .send(expensePayload());

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Expense added successfully");
    expect(response.body.data.amount).toBe(125.5);
    expect(response.body.data.category).toBe("utilities");
    expect(await Expense.countDocuments()).toBe(1);
  });

  test("defaults the category to other", async () => {
    const response = await request(app)
      .post("/api/expense")
      .set("Authorization", adminAuthorization)
      .send({ amount: 50, shortDescription: "Miscellaneous cost" });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe("other");
  });

  test("rejects invalid expense input", async () => {
    const invalidAmountResponse = await request(app)
      .post("/api/expense")
      .set("Authorization", adminAuthorization)
      .send(expensePayload({ amount: -1 }));
    expect(invalidAmountResponse.status).toBe(400);
    expect(invalidAmountResponse.body.message).toBe(
      "amount must be a non-negative number",
    );

    const missingDescriptionResponse = await request(app)
      .post("/api/expense")
      .set("Authorization", adminAuthorization)
      .send(expensePayload({ shortDescription: "   " }));
    expect(missingDescriptionResponse.status).toBe(400);
    expect(missingDescriptionResponse.body.message).toBe(
      "shortDescription is required",
    );

    const invalidCategoryResponse = await request(app)
      .post("/api/expense")
      .set("Authorization", adminAuthorization)
      .send(expensePayload({ category: "invalid" }));
    expect(invalidCategoryResponse.status).toBe(400);
    expect(invalidCategoryResponse.body.message).toBe("category is invalid");

    const invalidDateResponse = await request(app)
      .post("/api/expense")
      .set("Authorization", adminAuthorization)
      .send(expensePayload({ date: "not-a-date" }));
    expect(invalidDateResponse.status).toBe(400);
    expect(invalidDateResponse.body.message).toBe("date must be a valid date");
  });

  test("updates an existing expense", async () => {
    const expense = await Expense.create(expensePayload());

    const response = await request(app)
      .patch(`/api/expense/${expense._id}`)
      .set("Authorization", adminAuthorization)
      .send({
        amount: 300,
        shortDescription: "Updated expense",
        category: "marketing",
        date: "2031-02-20T12:00:00.000Z",
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Expense updated successfully");
    expect(response.body.data.amount).toBe(300);
    expect(response.body.data.shortDescription).toBe("Updated expense");
    expect(response.body.data.category).toBe("marketing");
  });

  test("validates update IDs and returns not found for missing expenses", async () => {
    const invalidResponse = await request(app)
      .patch("/api/expense/not-an-object-id")
      .set("Authorization", adminAuthorization)
      .send(expensePayload());
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.message).toBe("Invalid expense document id");

    const missingResponse = await request(app)
      .patch(`/api/expense/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", adminAuthorization)
      .send(expensePayload());
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.message).toBe("Expense not found");
  });

  test("deletes an existing expense", async () => {
    const expense = await Expense.create(expensePayload());

    const response = await request(app)
      .delete(`/api/expense/${expense._id}`)
      .set("Authorization", adminAuthorization);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Expense deleted successfully");
    expect(response.body.data._id).toBe(expense._id.toString());
    expect(await Expense.findById(expense._id)).toBeNull();
  });

  test("validates expense deletion IDs and missing expenses", async () => {
    const invalidResponse = await request(app)
      .delete("/api/expense/not-an-object-id")
      .set("Authorization", adminAuthorization);
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.message).toBe("Invalid expense document id");

    const missingResponse = await request(app)
      .delete(`/api/expense/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", adminAuthorization);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.message).toBe("Expense not found");
  });
});
