const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { Product } = require("../models/product");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Product Test User",
    email: `product-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

function productPayload(overrides = {}) {
  return {
    title: "Test Product",
    description: "A product used by product route tests",
    category: ["category-one"],
    price: 100,
    discountPrice: 90,
    imageURL: "https://example.com/product.jpg",
    totalStock: 10,
    outOfStock: false,
    visibility: true,
    ...overrides,
  };
}

async function createProduct(overrides = {}) {
  return Product.create(productPayload(overrides));
}

describe("product routes", () => {
  let adminAuthorization;
  let managerAuthorization;
  let cashierAuthorization;
  let normalAuthorization;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([Product.deleteMany({}), User.deleteMany({})]);

    const admin = await createUser({
      email: "product-admin@example.com",
      isAdmin: true,
    });
    const manager = await createUser({
      email: "product-manager@example.com",
      isAdmin: true,
      isMannager: true,
    });
    const cashier = await createUser({
      email: "product-cashier@example.com",
      isCashier: true,
    });
    const normalUser = await createUser({ email: "product-user@example.com" });

    adminAuthorization = authorizationFor(admin);
    managerAuthorization = authorizationFor(manager);
    cashierAuthorization = authorizationFor(cashier);
    normalAuthorization = authorizationFor(normalUser);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  test("returns products publicly", async () => {
    await createProduct({ title: "Newest Product" });
    await createProduct({ title: "Older Product" });

    const response = await request(app).get("/api/product");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
  });

  test("filters products by category", async () => {
    await createProduct({ category: ["drinks"] });
    await createProduct({ title: "Other Product", category: ["snacks"] });

    const response = await request(app).get("/api/product/category/drinks");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].category).toContain("drinks");
  });

  test("returns a product by ID and 404 for a missing product", async () => {
    const product = await createProduct();

    const response = await request(app).get(`/api/product/${product._id}`);
    expect(response.status).toBe(200);
    expect(response.body.data._id).toBe(product._id.toString());

    const missingResponse = await request(app).get(
      `/api/product/${new mongoose.Types.ObjectId()}`,
    );
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.message).toBe("Product not found");
  });

  test("requires admin access for out-of-stock products", async () => {
    await createProduct({ outOfStock: true, totalStock: 0 });

    const unauthorizedResponse = await request(app)
      .get("/api/product/out-of-stock")
      .set("Authorization", normalAuthorization);
    expect(unauthorizedResponse.status).toBe(403);

    const response = await request(app)
      .get("/api/product/out-of-stock")
      .set("Authorization", adminAuthorization);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].outOfStock).toBe(true);
  });

  test("creates a product for an admin and records the creator", async () => {
    const response = await request(app)
      .post("/api/product")
      .set("Authorization", adminAuthorization)
      .send(productPayload());

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Product added successfully");
    expect(response.body.data.addedBy.name).toBe("Product Test User");
    expect(await Product.countDocuments()).toBe(1);
  });

  test("allows managers to create products but rejects normal users", async () => {
    const managerResponse = await request(app)
      .post("/api/product")
      .set("Authorization", managerAuthorization)
      .send(productPayload({ title: "Manager Product" }));
    expect(managerResponse.status).toBe(201);

    const normalResponse = await request(app)
      .post("/api/product")
      .set("Authorization", normalAuthorization)
      .send(productPayload({ title: "Unauthorized Product" }));
    expect(normalResponse.status).toBe(403);
  });

  test("rejects invalid product data", async () => {
    const response = await request(app)
      .post("/api/product")
      .set("Authorization", adminAuthorization)
      .send({ title: "Bad" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid product data");
    expect(response.body.success).toBe(false);
  });

  test("updates product stock and derives out-of-stock state", async () => {
    const product = await createProduct();

    const response = await request(app)
      .patch(`/api/product/${product._id}/stock`)
      .set("Authorization", cashierAuthorization)
      .send({ totalStock: 0 });

    expect(response.status).toBe(200);
    expect(response.body.data.totalStock).toBe(0);
    expect(response.body.data.outOfStock).toBe(true);
  });

  test("rejects invalid stock quantities and unauthorized stock updates", async () => {
    const product = await createProduct();

    const invalidResponse = await request(app)
      .patch(`/api/product/${product._id}/stock`)
      .set("Authorization", cashierAuthorization)
      .send({ totalStock: -1 });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.message).toMatch(/non-negative whole number/i);

    const unauthorizedResponse = await request(app)
      .patch(`/api/product/${product._id}/stock`)
      .set("Authorization", normalAuthorization)
      .send({ totalStock: 5 });
    expect(unauthorizedResponse.status).toBe(403);
  });

  test("updates a product for catalog users", async () => {
    const product = await createProduct();

    const response = await request(app)
      .put(`/api/product/${product._id}`)
      .set("Authorization", managerAuthorization)
      .send({ title: "Updated Product", price: 125 });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Product updated successfully");
    expect(response.body.data.title).toBe("Updated Product");
    expect(response.body.data.price).toBe(125);
  });

  test("returns 404 when updating or deleting a missing product", async () => {
    const missingId = new mongoose.Types.ObjectId();

    const updateResponse = await request(app)
      .put(`/api/product/${missingId}`)
      .set("Authorization", adminAuthorization)
      .send({ title: "Missing Product" });
    expect(updateResponse.status).toBe(404);
    expect(updateResponse.body.message).toBe("Product not found");

    const deleteResponse = await request(app)
      .delete(`/api/product/${missingId}`)
      .set("Authorization", adminAuthorization);
    expect(deleteResponse.status).toBe(404);
    expect(deleteResponse.body.message).toBe("Product not found");
  });

  test("deletes a product for catalog users", async () => {
    const product = await createProduct();

    const response = await request(app)
      .delete(`/api/product/${product._id}`)
      .set("Authorization", adminAuthorization);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Product deleted successfully");
    expect(await Product.findById(product._id)).toBeNull();
  });
});
