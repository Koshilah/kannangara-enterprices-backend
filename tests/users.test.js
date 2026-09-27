const { mongodbTestUri } = require("./testConfig");

const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  const user = await User.create({
    name: "Test User",
    email: `user-${Date.now()}-${Math.random()}@example.com`,
    phone: "0771234567",
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });

  return user;
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

describe("users routes", () => {
  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await User.deleteMany({});
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  describe("POST /api/user", () => {
    test("registers a user and returns an access token header", async () => {
      const response = await request(app).post("/api/user").send({
        name: "New User",
        email: "new.user@example.com",
        phone: "0771234567",
        password: validPassword,
      });

      expect(response.status).toBe(200);
      expect(response.headers["x-auth-token"]).toBeTruthy();
      expect(response.text).toBe(response.headers["x-auth-token"]);

      const user = await User.findOne({ email: "new.user@example.com" });
      expect(user).not.toBeNull();
      expect(user.password).not.toBe(validPassword);
      expect(await bcrypt.compare(validPassword, user.password)).toBe(true);
    });

    test("rejects invalid registration data", async () => {
      const response = await request(app).post("/api/user").send({
        name: "A",
        email: "not-an-email",
        password: "weak",
      });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test("rejects duplicate email addresses", async () => {
      await createUser({ email: "duplicate@example.com" });

      const response = await request(app).post("/api/user").send({
        name: "Another User",
        email: "duplicate@example.com",
        password: validPassword,
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/already registered/i);
    });

    test("does not allow registration to assign manager privileges", async () => {
      const response = await request(app).post("/api/user").send({
        name: "Untrusted User",
        email: "untrusted@example.com",
        password: validPassword,
        isAdmin: true,
        isMannager: true,
      });

      expect(response.status).toBe(400);
      expect(await User.findOne({ email: "untrusted@example.com" })).toBeNull();
    });
  });

  describe("authentication and profile routes", () => {
    test("rejects requests without a bearer token", async () => {
      const response = await request(app).get("/api/user/profile");

      expect(response.status).toBe(401);
    });

    test("rejects invalid bearer tokens", async () => {
      const response = await request(app)
        .get("/api/user/profile")
        .set("Authorization", "Bearer invalid-token");

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Invalid token");
    });

    test("returns and updates the authenticated user's profile", async () => {
      const user = await createUser();
      const authorization = authorizationFor(user);

      const profileResponse = await request(app)
        .get("/api/user/profile")
        .set("Authorization", authorization);
      expect(profileResponse.status).toBe(200);
      expect(profileResponse.body.data.email).toBe(user.email);

      const updateResponse = await request(app)
        .patch("/api/user/profile")
        .set("Authorization", authorization)
        .send({
          name: "Updated User",
          email: "updated@example.com",
          phone: "0712345678",
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.data.email).toBe("updated@example.com");
      expect((await User.findById(user._id)).name).toBe("Updated User");
    });

    test("rejects profile updates that use another user's email", async () => {
      const user = await createUser({ email: "profile-owner@example.com" });
      await createUser({ email: "already-used@example.com" });

      const response = await request(app)
        .patch("/api/user/profile")
        .set("Authorization", authorizationFor(user))
        .send({ name: "Updated User", email: "already-used@example.com" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Email is already in use.");
    });

    test("changes the password only when the current password is correct", async () => {
      const user = await createUser();
      const authorization = authorizationFor(user);

      const wrongPasswordResponse = await request(app)
        .patch("/api/user/profile/password")
        .set("Authorization", authorization)
        .send({
          currentPassword: "WrongPassword1!",
          newPassword: "NewPassword1!",
        });
      expect(wrongPasswordResponse.status).toBe(401);

      const response = await request(app)
        .patch("/api/user/profile/password")
        .set("Authorization", authorization)
        .send({ currentPassword: validPassword, newPassword: "NewPassword1!" });
      expect(response.status).toBe(200);

      const updatedUser = await User.findById(user._id);
      expect(await bcrypt.compare("NewPassword1!", updatedUser.password)).toBe(
        true,
      );
    });

    test("deletes the account only with the correct password", async () => {
      const user = await createUser();
      const authorization = authorizationFor(user);

      const incorrectResponse = await request(app)
        .delete("/api/user")
        .set("Authorization", authorization)
        .send({ password: "WrongPassword1!" });
      expect(incorrectResponse.status).toBe(401);

      const response = await request(app)
        .delete("/api/user")
        .set("Authorization", authorization)
        .send({ password: validPassword });
      expect(response.status).toBe(200);
      expect(await User.findById(user._id)).toBeNull();
    });
  });

  describe("manager and employee routes", () => {
    test("denies manager routes to normal users", async () => {
      const user = await createUser();

      const response = await request(app)
        .get("/api/user/employees")
        .set("Authorization", authorizationFor(user));

      expect(response.status).toBe(403);
    });

    test("allows managers to list and create employees", async () => {
      const manager = await createUser({
        email: "manager@example.com",
        isAdmin: true,
        isMannager: true,
        isCashier: true,
      });
      const authorization = authorizationFor(manager);

      const listResponse = await request(app)
        .get("/api/user/employees")
        .set("Authorization", authorization);
      expect(listResponse.status).toBe(200);

      const createResponse = await request(app)
        .post("/api/user/employees")
        .set("Authorization", authorization)
        .send({
          name: "Cashier User",
          email: "cashier@example.com",
          phone: "0712345678",
          password: validPassword,
          role: "cashier",
        });
      expect(createResponse.status).toBe(201);
      expect(createResponse.body.data.isCashier).toBe(true);
      expect(createResponse.body.data.isMannager).toBe(false);
    });

    test("rejects invalid employee roles", async () => {
      const manager = await createUser({ isAdmin: true, isMannager: true });

      const response = await request(app)
        .post("/api/user/employees")
        .set("Authorization", authorizationFor(manager))
        .send({
          name: "Invalid Role",
          email: "invalid-role@example.com",
          password: validPassword,
          role: "owner",
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/valid employee role/i);
    });

    test("promotes and demotes another user", async () => {
      const manager = await createUser({ isAdmin: true, isMannager: true });
      const employee = await createUser({ email: "employee@example.com" });
      const authorization = authorizationFor(manager);

      const promoteResponse = await request(app)
        .patch("/api/user/promote")
        .set("Authorization", authorization)
        .send({ email: employee.email });
      expect(promoteResponse.status).toBe(200);
      expect((await User.findById(employee._id)).isAdmin).toBe(true);

      const demoteResponse = await request(app)
        .patch(`/api/user/employees/${employee._id}/demote`)
        .set("Authorization", authorization);
      expect(demoteResponse.status).toBe(200);
      const demoted = await User.findById(employee._id);
      expect(demoted.isAdmin).toBe(false);
      expect(demoted.isMannager).toBe(false);
      expect(demoted.isCashier).toBe(false);
    });

    test("prevents a manager from removing their own manager access", async () => {
      const manager = await createUser({ isAdmin: true, isMannager: true });
      const authorization = authorizationFor(manager);

      const roleResponse = await request(app)
        .patch(`/api/user/employees/${manager._id}/role`)
        .set("Authorization", authorization)
        .send({ role: "admin" });
      expect(roleResponse.status).toBe(400);

      const demoteResponse = await request(app)
        .patch(`/api/user/employees/${manager._id}/demote`)
        .set("Authorization", authorization);
      expect(demoteResponse.status).toBe(400);
    });

    test("looks up a user by email for a manager", async () => {
      const manager = await createUser({ isAdmin: true, isMannager: true });
      await createUser({ email: "lookup@example.com" });

      const response = await request(app)
        .get("/api/user")
        .query({ email: "lookup@example.com" })
        .set("Authorization", authorizationFor(manager));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        name: "Test User",
        email: "lookup@example.com",
      });
    });
  });
});
