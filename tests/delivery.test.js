const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { Delivery } = require("../models/delivery");
const Order = require("../models/order");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Delivery Test User",
    email: `delivery-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

async function createOrder(user) {
  return Order.create({
    userID: user._id,
    items: [
      {
        productID: new mongoose.Types.ObjectId(),
        title: "Delivery Product",
        priceSingle: 100,
        originalPriceSingle: 100,
        quantity: 1,
        priceTotal: 100,
        savingsTotal: 0,
      },
    ],
    subtotal: 100,
    orderTotal: 100,
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    orderStatus: "processing",
    deliveryAddress: "1 Delivery Road",
    estimatedDeliveryDate: new Date(Date.now() + 86400000),
  });
}

async function createDelivery(user, overrides = {}) {
  const order = await createOrder(user);
  const delivery = await Delivery.create({
    orderID: order._id,
    userID: user._id,
    deliveryAddress: "1 Delivery Road",
    dueDate: new Date(Date.now() + 86400000),
    ...overrides,
  });

  return { delivery, order };
}

describe("delivery routes", () => {
  let adminAuthorization;
  let userAuthorization;
  let user;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([
      Delivery.deleteMany({}),
      Order.deleteMany({}),
      User.deleteMany({}),
    ]);

    const admin = await createUser({
      email: "delivery-admin@example.com",
      isAdmin: true,
    });
    user = await createUser({ email: "delivery-user@example.com" });
    adminAuthorization = authorizationFor(admin);
    userAuthorization = authorizationFor(user);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  test("requires authentication and admin access", async () => {
    const unauthenticatedResponse = await request(app).get("/api/delivery");
    expect(unauthenticatedResponse.status).toBe(401);

    const unauthorizedResponse = await request(app)
      .get("/api/delivery")
      .set("Authorization", userAuthorization);
    expect(unauthorizedResponse.status).toBe(403);
  });

  test("returns deliveries with populated order and user data", async () => {
    await createDelivery(user);

    const response = await request(app)
      .get("/api/delivery")
      .set("Authorization", adminAuthorization);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].orderID.userID).toBe(user._id.toString());
    expect(response.body.data[0].userID).toMatchObject({
      name: user.name,
      email: user.email,
    });
  });

  test("updates delivery status", async () => {
    const { delivery } = await createDelivery(user);

    const response = await request(app)
      .patch("/api/delivery/status")
      .set("Authorization", adminAuthorization)
      .send({ deliveryID: delivery._id, status: "out_for_delivery" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Delivery status updated successfully");
    expect(response.body.data.status).toBe("out_for_delivery");
    expect((await Delivery.findById(delivery._id)).status).toBe(
      "out_for_delivery",
    );
  });

  test("rejects invalid delivery status and IDs", async () => {
    const invalidIdResponse = await request(app)
      .patch("/api/delivery/status")
      .set("Authorization", adminAuthorization)
      .send({ deliveryID: "not-an-object-id", status: "pending" });
    expect(invalidIdResponse.status).toBe(400);
    expect(invalidIdResponse.body.message).toBe(
      "A valid deliveryID is required",
    );

    const invalidStatusResponse = await request(app)
      .patch("/api/delivery/status")
      .set("Authorization", adminAuthorization)
      .send({ deliveryID: new mongoose.Types.ObjectId(), status: "unknown" });
    expect(invalidStatusResponse.status).toBe(400);
    expect(invalidStatusResponse.body.message).toMatch(
      /status must be one of/i,
    );
  });

  test("returns not found when updating a missing delivery", async () => {
    const response = await request(app)
      .patch("/api/delivery/status")
      .set("Authorization", adminAuthorization)
      .send({ deliveryID: new mongoose.Types.ObjectId(), status: "delivered" });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Delivery not found");
  });

  test("updates a delivery due date", async () => {
    const { delivery } = await createDelivery(user);
    const dueDate = "2030-01-15T10:00:00.000Z";

    const response = await request(app)
      .patch("/api/delivery/due-date")
      .set("Authorization", adminAuthorization)
      .send({ deliveryID: delivery._id, dueDate });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe(
      "Delivery due date updated successfully",
    );
    expect(new Date(response.body.data.dueDate).toISOString()).toBe(dueDate);
  });

  test("rejects invalid due dates and missing delivery IDs", async () => {
    const missingIdResponse = await request(app)
      .patch("/api/delivery/due-date")
      .set("Authorization", adminAuthorization)
      .send({ dueDate: "2030-01-15" });
    expect(missingIdResponse.status).toBe(400);
    expect(missingIdResponse.body.message).toBe(
      "A valid deliveryID is required",
    );

    const invalidDateResponse = await request(app)
      .patch("/api/delivery/due-date")
      .set("Authorization", adminAuthorization)
      .send({
        deliveryID: new mongoose.Types.ObjectId(),
        dueDate: "not-a-date",
      });
    expect(invalidDateResponse.status).toBe(400);
    expect(invalidDateResponse.body.message).toBe(
      "dueDate must be a valid date",
    );
  });

  test("returns not found when updating a missing delivery due date", async () => {
    const response = await request(app)
      .patch("/api/delivery/due-date")
      .set("Authorization", adminAuthorization)
      .send({
        deliveryID: new mongoose.Types.ObjectId(),
        dueDate: "2030-01-15T10:00:00.000Z",
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("Delivery not found");
  });

  test("only deletes delivered deliveries", async () => {
    const { delivery: pendingDelivery } = await createDelivery(user);
    const pendingResponse = await request(app)
      .delete(`/api/delivery/${pendingDelivery._id}`)
      .set("Authorization", adminAuthorization);
    expect(pendingResponse.status).toBe(409);
    expect(pendingResponse.body.message).toBe(
      "Only delivered deliveries can be deleted",
    );

    const { delivery: deliveredDelivery } = await createDelivery(user, {
      status: "delivered",
    });
    const deliveredResponse = await request(app)
      .delete(`/api/delivery/${deliveredDelivery._id}`)
      .set("Authorization", adminAuthorization);
    expect(deliveredResponse.status).toBe(200);
    expect(deliveredResponse.body.message).toBe(
      "Delivery deleted successfully",
    );
    expect(await Delivery.findById(deliveredDelivery._id)).toBeNull();
  });

  test("rejects invalid and missing delivery deletions", async () => {
    const invalidResponse = await request(app)
      .delete("/api/delivery/not-an-object-id")
      .set("Authorization", adminAuthorization);
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.message).toBe("Invalid delivery document id");

    const missingResponse = await request(app)
      .delete(`/api/delivery/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", adminAuthorization);
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.message).toBe("Delivery not found");
  });
});
