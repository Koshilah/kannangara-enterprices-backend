const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const Order = require("../models/order");
const Cart = require("../models/cart");
const { Delivery } = require("../models/delivery");
const { Product } = require("../models/product");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Order Test User",
    email: `order-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

async function createProduct(overrides = {}) {
  return Product.create({
    title: "Order Product",
    description: "A product used by order route tests",
    price: 100,
    discountPrice: 80,
    imageURL: "https://example.com/order-product.jpg",
    totalStock: 10,
    ...overrides,
  });
}

async function createOrder(user, overrides = {}) {
  return Order.create({
    userID: user._id,
    items: [
      {
        productID: new mongoose.Types.ObjectId(),
        title: "Order Product",
        priceSingle: 100,
        originalPriceSingle: 100,
        quantity: 1,
        priceTotal: 100,
        savingsTotal: 0,
      },
    ],
    subtotal: 100,
    totalSavings: 0,
    deliveryFee: 0,
    orderTotal: 100,
    paymentMethod: "Cash on Delivery",
    paymentStatus: "pending",
    orderStatus: "processing",
    orderType: "delivery",
    deliveryAddress: "1 Test Road",
    estimatedDeliveryDate: new Date(Date.now() + 86400000),
    ...overrides,
  });
}

describe("order routes", () => {
  let user;
  let admin;
  let userAuthorization;
  let adminAuthorization;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([
      Order.deleteMany({}),
      Cart.deleteMany({}),
      Delivery.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
    ]);

    user = await createUser({ email: "order-user@example.com" });
    admin = await createUser({
      email: "order-admin@example.com",
      isAdmin: true,
    });
    userAuthorization = authorizationFor(user);
    adminAuthorization = authorizationFor(admin);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  test("requires payment method and delivery address for delivery orders", async () => {
    const missingPaymentResponse = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({ deliveryAddress: "1 Test Road" });
    expect(missingPaymentResponse.status).toBe(400);
    expect(missingPaymentResponse.body.message).toBe(
      "paymentMethod is required",
    );

    const missingAddressResponse = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({ paymentMethod: "Card" });
    expect(missingAddressResponse.status).toBe(400);
    expect(missingAddressResponse.body.message).toBe(
      "deliveryAddress is required for delivery orders",
    );
  });

  test("rejects order creation when the cart is missing or empty", async () => {
    const missingCartResponse = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({
        paymentMethod: "Cash on Delivery",
        deliveryAddress: "1 Test Road",
      });
    expect(missingCartResponse.status).toBe(404);
    expect(missingCartResponse.body.message).toBe("Cart not found");

    await Cart.create({ userId: user._id, items: [] });
    const emptyCartResponse = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({
        paymentMethod: "Cash on Delivery",
        deliveryAddress: "1 Test Road",
      });
    expect(emptyCartResponse.status).toBe(400);
    expect(emptyCartResponse.body.message).toBe("Cart is empty");
  });

  test("rejects card orders while card payments are disabled", async () => {
    const product = await createProduct();
    const cart = await Cart.create({
      userId: user._id,
      items: [{ productId: product._id, quantity: 1 }],
    });

    const response = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({
        cartID: cart._id,
        paymentMethod: "Visa / MasterCard",
        deliveryAddress: "1 Test Road",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Only cash payment is currently available",
    );
  });

  test("creates a delivery order, creates delivery tracking, and clears the cart", async () => {
    const product = await createProduct();
    const cart = await Cart.create({
      userId: user._id,
      items: [{ productId: product._id, quantity: 2 }],
    });

    const response = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({
        cartID: cart._id,
        paymentMethod: "Cash on Delivery",
        deliveryAddress: "1 Test Road",
      });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Order created successfully");
    expect(response.body.data.orderTotal).toBe(160);
    expect(response.body.data.paymentStatus).toBe("pending");
    expect(response.body.data.orderType).toBe("delivery");
    expect(
      await Cart.findById(cart._id).then((savedCart) => savedCart.items),
    ).toHaveLength(0);
    expect(
      await Delivery.countDocuments({ orderID: response.body.data._id }),
    ).toBe(1);
  });

  test("creates a pickup order without delivery tracking", async () => {
    const product = await createProduct();
    await Cart.create({
      userId: user._id,
      items: [{ productId: product._id, quantity: 1 }],
    });

    const response = await request(app)
      .post("/api/order")
      .set("Authorization", userAuthorization)
      .send({ paymentMethod: "Cash", orderType: "pickup" });

    expect(response.status).toBe(201);
    expect(response.body.data.deliveryAddress).toBe(
      "Store Pickup (Kannangara Enterprises)",
    );
    expect(response.body.data.paymentStatus).toBe("pending");
    expect(
      await Delivery.countDocuments({ orderID: response.body.data._id }),
    ).toBe(0);
  });

  test("returns only the authenticated user's orders with delivery status", async () => {
    const ownOrder = await createOrder(user);
    const otherUser = await createUser({
      email: "other-order-user@example.com",
    });
    await createOrder(otherUser);
    await Delivery.create({
      orderID: ownOrder._id,
      userID: user._id,
      deliveryAddress: "1 Test Road",
      dueDate: new Date(Date.now() + 86400000),
      status: "processing",
    });

    const response = await request(app)
      .get("/api/order/my-orders")
      .set("Authorization", userAuthorization);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].deliveryStatus).toBe("processing");
  });

  test("allows admins to list orders and view order details", async () => {
    const order = await createOrder(user);
    await Delivery.create({
      orderID: order._id,
      userID: user._id,
      deliveryAddress: "1 Test Road",
      dueDate: new Date(Date.now() + 86400000),
    });

    const listResponse = await request(app)
      .get("/api/order")
      .set("Authorization", adminAuthorization);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].userID.email).toBe(user.email);

    const detailsResponse = await request(app)
      .get(`/api/order/${order._id}`)
      .set("Authorization", adminAuthorization);
    expect(detailsResponse.status).toBe(200);
    expect(detailsResponse.body.data.order._id).toBe(order._id.toString());
    expect(detailsResponse.body.data.delivery.status).toBe("pending");
  });

  test("rejects non-admin access to admin order endpoints", async () => {
    const response = await request(app)
      .get("/api/order")
      .set("Authorization", userAuthorization);

    expect(response.status).toBe(403);
  });

  test("allows an owner to cancel an order and updates delivery status", async () => {
    const order = await createOrder(user);
    await Delivery.create({
      orderID: order._id,
      userID: user._id,
      deliveryAddress: "1 Test Road",
      dueDate: new Date(Date.now() + 86400000),
    });

    const response = await request(app)
      .patch(`/api/order/${order._id}/cancel`)
      .set("Authorization", userAuthorization);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Order cancelled successfully");
    expect((await Order.findById(order._id)).orderStatus).toBe("cancelled");
    expect((await Delivery.findOne({ orderID: order._id })).status).toBe(
      "cancelled",
    );
  });

  test("prevents users from cancelling another user's order", async () => {
    const otherUser = await createUser({
      email: "owner-order-user@example.com",
    });
    const order = await createOrder(otherUser);

    const response = await request(app)
      .patch(`/api/order/${order._id}/cancel`)
      .set("Authorization", userAuthorization);

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("You can only cancel your own orders");
  });

  test("rejects cancellation of delivered or already cancelled orders", async () => {
    const deliveredOrder = await createOrder(user, {
      orderStatus: "delivered",
    });
    const deliveredResponse = await request(app)
      .patch(`/api/order/${deliveredOrder._id}/cancel`)
      .set("Authorization", userAuthorization);
    expect(deliveredResponse.status).toBe(409);
    expect(deliveredResponse.body.message).toContain("delivered");

    const cancelledOrder = await createOrder(user, {
      orderStatus: "cancelled",
    });
    const cancelledResponse = await request(app)
      .patch(`/api/order/${cancelledOrder._id}/cancel`)
      .set("Authorization", userAuthorization);
    expect(cancelledResponse.status).toBe(409);
    expect(cancelledResponse.body.message).toContain("cancelled");
  });

  test("updates payment and order statuses for admins", async () => {
    const order = await createOrder(user);

    const paymentResponse = await request(app)
      .patch(`/api/order/${order._id}/payment`)
      .set("Authorization", adminAuthorization)
      .send({ paymentStatus: "paid" });
    expect(paymentResponse.status).toBe(200);
    expect(paymentResponse.body.data.paymentStatus).toBe("paid");
    expect(paymentResponse.body.data.paidAt).toBeTruthy();

    const statusResponse = await request(app)
      .patch("/api/order")
      .set("Authorization", adminAuthorization)
      .send({ orderID: order._id, orderStatus: "shipped" });
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data.orderStatus).toBe("shipped");
  });

  test("rejects invalid order IDs and payment/status values", async () => {
    const invalidDetailsResponse = await request(app)
      .get("/api/order/not-an-object-id")
      .set("Authorization", adminAuthorization);
    expect(invalidDetailsResponse.status).toBe(400);
    expect(invalidDetailsResponse.body.message).toBe("Invalid order id");

    const invalidPaymentResponse = await request(app)
      .patch("/api/order/not-an-object-id/payment")
      .set("Authorization", adminAuthorization)
      .send({ paymentStatus: "unknown" });
    expect(invalidPaymentResponse.status).toBe(400);

    const missingStatusResponse = await request(app)
      .patch("/api/order")
      .set("Authorization", adminAuthorization)
      .send({ orderID: new mongoose.Types.ObjectId() });
    expect(missingStatusResponse.status).toBe(400);
    expect(missingStatusResponse.body.message).toBe(
      "orderID and orderStatus are required",
    );
  });
});
