const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const Cart = require("../models/cart");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Cart Test User",
    email: `cart-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

describe("cart routes", () => {
  let user;
  let authorization;
  let otherAuthorization;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([Cart.deleteMany({}), User.deleteMany({})]);

    user = await createUser({ email: "cart-user@example.com" });
    const otherUser = await createUser({
      email: "other-cart-user@example.com",
    });
    authorization = authorizationFor(user);
    otherAuthorization = authorizationFor(otherUser);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  test("requires authentication", async () => {
    const response = await request(app).get("/api/cart");

    expect(response.status).toBe(401);
  });

  test("returns an empty cart and zero count when no cart exists", async () => {
    const cartResponse = await request(app)
      .get("/api/cart")
      .set("Authorization", authorization);
    expect(cartResponse.status).toBe(200);
    expect(cartResponse.body).toEqual({ success: true, data: [] });

    const countResponse = await request(app)
      .get("/api/cart/count")
      .set("Authorization", authorization);
    expect(countResponse.status).toBe(200);
    expect(countResponse.body).toEqual({ success: true, data: 0 });
  });

  test("requires a product ID when adding an item", async () => {
    const response = await request(app)
      .post("/api/cart")
      .set("Authorization", authorization)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("productID is required");
  });

  test("creates a cart and increments quantity for duplicate products", async () => {
    const productID = new mongoose.Types.ObjectId().toString();

    const createResponse = await request(app)
      .post("/api/cart")
      .set("Authorization", authorization)
      .send({ productID });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.message).toBe("Cart created successfully");
    expect(createResponse.body.data.items[0].quantity).toBe(1);

    const duplicateResponse = await request(app)
      .post("/api/cart")
      .set("Authorization", authorization)
      .send({ productID });
    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body.message).toBe("Cart updated successfully");
    expect(duplicateResponse.body.data.items[0].quantity).toBe(2);
  });

  test("adds different products to the same cart", async () => {
    const firstProductID = new mongoose.Types.ObjectId().toString();
    const secondProductID = new mongoose.Types.ObjectId().toString();

    await request(app)
      .post("/api/cart")
      .set("Authorization", authorization)
      .send({ productID: firstProductID });
    const response = await request(app)
      .post("/api/cart")
      .set("Authorization", authorization)
      .send({ productID: secondProductID });

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items.map((item) => item.productId)).toEqual(
      expect.arrayContaining([firstProductID, secondProductID]),
    );
  });

  test("returns the authenticated user's cart and total quantity", async () => {
    await Cart.create({
      userId: user._id,
      items: [
        { productId: new mongoose.Types.ObjectId(), quantity: 2 },
        { productId: new mongoose.Types.ObjectId(), quantity: 3 },
      ],
    });

    const cartResponse = await request(app)
      .get("/api/cart")
      .set("Authorization", authorization);
    expect(cartResponse.status).toBe(200);
    expect(cartResponse.body.data.userId).toBe(user._id.toString());
    expect(cartResponse.body.data.items).toHaveLength(2);

    const countResponse = await request(app)
      .get("/api/cart/count")
      .set("Authorization", authorization);
    expect(countResponse.body.data).toBe(5);
  });

  test("updates an item quantity explicitly or by incrementing", async () => {
    const productID = new mongoose.Types.ObjectId().toString();
    await Cart.create({
      userId: user._id,
      items: [{ productId: productID, quantity: 1 }],
    });

    const explicitResponse = await request(app)
      .patch("/api/cart")
      .set("Authorization", authorization)
      .send({ productID, updatedQuantity: 4 });
    expect(explicitResponse.status).toBe(200);
    expect(explicitResponse.body.data.items[0].quantity).toBe(4);

    const incrementResponse = await request(app)
      .patch("/api/cart")
      .set("Authorization", authorization)
      .send({ productID });
    expect(incrementResponse.status).toBe(200);
    expect(incrementResponse.body.data.items[0].quantity).toBe(5);
  });

  test("rejects invalid quantity updates", async () => {
    const productID = new mongoose.Types.ObjectId().toString();
    await Cart.create({
      userId: user._id,
      items: [{ productId: productID, quantity: 1 }],
    });

    const response = await request(app)
      .patch("/api/cart")
      .set("Authorization", authorization)
      .send({ productID, updatedQuantity: 0 });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "updatedQuantity must be an integer greater than zero",
    );
  });

  test("removes an item from the authenticated user's cart", async () => {
    const productID = new mongoose.Types.ObjectId().toString();
    await Cart.create({
      userId: user._id,
      items: [{ productId: productID, quantity: 2 }],
    });

    const response = await request(app)
      .delete(`/api/cart/${productID}`)
      .set("Authorization", authorization);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Cart item removed successfully");
    expect(response.body.data.items).toHaveLength(0);
  });

  test("returns errors for missing carts and missing cart items", async () => {
    const productID = new mongoose.Types.ObjectId().toString();

    const deleteResponse = await request(app)
      .delete(`/api/cart/${productID}`)
      .set("Authorization", authorization);
    expect(deleteResponse.status).toBe(404);
    expect(deleteResponse.body.message).toBe("Cart not found");

    await Cart.create({
      userId: user._id,
      items: [{ productId: new mongoose.Types.ObjectId(), quantity: 1 }],
    });
    const updateResponse = await request(app)
      .patch("/api/cart")
      .set("Authorization", authorization)
      .send({ productID });
    expect(updateResponse.status).toBe(404);
    expect(updateResponse.body.message).toBe("Product not found in cart");
  });

  test("does not expose another user's cart", async () => {
    const productID = new mongoose.Types.ObjectId().toString();
    await Cart.create({
      userId: user._id,
      items: [{ productId: productID, quantity: 1 }],
    });

    const response = await request(app)
      .get("/api/cart")
      .set("Authorization", otherAuthorization);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});
