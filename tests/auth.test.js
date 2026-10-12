const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { User } = require("../models/user");
const RefreshToken = require("../models/refreshToken");
const AuditLog = require("../models/auditLog");
const { generateTokenHash } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Auth Test User",
    email: `auth-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

async function loginUser(user = {}) {
  const credentials = {
    email: user.email,
    password: validPassword,
  };

  return request(app).post("/api/auth").send(credentials);
}

async function waitForAuditCount(query, count) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await AuditLog.countDocuments(query)) === count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("auth routes", () => {
  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      RefreshToken.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  describe("POST /api/auth", () => {
    test("requires both email and password", async () => {
      const response = await request(app).post("/api/auth").send({
        email: "auth@example.com",
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Provide both email and password!");
    });

    test("rejects unknown users and incorrect passwords", async () => {
      const unknownUserResponse = await request(app)
        .post("/api/auth")
        .send({ email: "missing@example.com", password: validPassword });
      expect(unknownUserResponse.status).toBe(400);
      expect(unknownUserResponse.body.message).toBe(
        "Invalid email or password",
      );

      const user = await createUser({ email: "auth@example.com" });
      const incorrectPasswordResponse = await request(app)
        .post("/api/auth")
        .send({ email: user.email, password: "WrongPassword1!" });
      expect(incorrectPasswordResponse.status).toBe(400);
      expect(incorrectPasswordResponse.body.message).toBe(
        "Invalid email or password",
      );
    });

    test("returns an access token and persists a refresh token", async () => {
      const user = await createUser({ email: "login@example.com" });

      const response = await loginUser(user);

      expect(response.status).toBe(200);
      expect(response.headers["x-auth-token"]).toBeTruthy();
      expect(response.text).toBe(response.headers["x-auth-token"]);
      expect(response.headers["set-cookie"][0]).toContain("refresh_token=");
      expect(await RefreshToken.countDocuments({ user: user._id })).toBe(1);
    });

    test("audits successful logins only for cashiers, admins, and managers", async () => {
      const users = await Promise.all([
        createUser({ email: "cashier-login@example.com", isCashier: true }),
        createUser({ email: "admin-login@example.com", isAdmin: true }),
        createUser({
          email: "manager-login@example.com",
          isMannager: true,
        }),
        createUser({ email: "user-login@example.com" }),
      ]);

      for (const user of users) {
        const response = await loginUser(user);
        expect(response.status).toBe(200);
      }

      await waitForAuditCount({ action: "LOGIN_SUCCEEDED" }, 3);
      expect(await AuditLog.countDocuments({ action: "LOGIN_SUCCEEDED" })).toBe(
        3,
      );
      expect(
        await AuditLog.countDocuments({
          action: "LOGIN_SUCCEEDED",
          userId: users[3]._id,
        }),
      ).toBe(0);
    });
  });

  describe("POST /api/auth/refresh", () => {
    test("requires a refresh-token cookie", async () => {
      const response = await request(app).post("/api/auth/refresh");

      expect(response.status).toBe(401);
      expect(response.body.message).toBe("No Refresh Token");
    });

    test("rejects invalid and expired refresh tokens", async () => {
      const invalidResponse = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", "refresh_token=invalid-token");
      expect(invalidResponse.status).toBe(401);
      expect(invalidResponse.body.message).toBe(
        "Invalid or expired refresh token",
      );

      const expiredToken = jwt.sign(
        { id: new mongoose.Types.ObjectId().toString(), jti: "expired-jti" },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: -1 },
      );
      const expiredResponse = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", `refresh_token=${expiredToken}`);
      expect(expiredResponse.status).toBe(401);
      expect(expiredResponse.body.message).toBe(
        "Invalid or expired refresh token",
      );
    });

    test("rotates the refresh token and revokes the previous token", async () => {
      const user = await createUser({ email: "refresh@example.com" });
      const loginResponse = await loginUser(user);
      const originalCookie =
        loginResponse.headers["set-cookie"][0].split(";")[0];
      const originalToken = originalCookie.split("=")[1];

      const refreshResponse = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", originalCookie);

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.headers["x-auth-token"]).toBeTruthy();
      expect(refreshResponse.headers["set-cookie"][0]).toContain(
        "refresh_token=",
      );

      const originalDocument = await RefreshToken.findOne({
        tokenHash: generateTokenHash(originalToken),
      });
      expect(originalDocument.revokedAt).not.toBeNull();
      expect(await RefreshToken.countDocuments({ user: user._id })).toBe(2);

      const reusedResponse = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", originalCookie);
      expect(reusedResponse.status).toBe(401);
      expect(reusedResponse.body.message).toBe("Refresh token revoked");
    });
  });

  describe("POST /api/auth/logout", () => {
    test("logs out successfully without an existing refresh token", async () => {
      const response = await request(app).post("/api/auth/logout");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, message: "Logged out" });
    });

    test("revokes the current refresh token", async () => {
      const user = await createUser({ email: "logout@example.com" });
      const loginResponse = await loginUser(user);
      const cookie = loginResponse.headers["set-cookie"][0].split(";")[0];
      const token = cookie.split("=")[1];

      const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", cookie);

      expect(response.status).toBe(200);
      const tokenDocument = await RefreshToken.findOne({
        tokenHash: generateTokenHash(token),
      });
      expect(tokenDocument.revokedAt).not.toBeNull();
    });
  });

  describe("POST /api/auth/verify-email", () => {
    test("rejects missing or invalid email", async () => {
      const missingResponse = await request(app)
        .post("/api/auth/verify-email")
        .send({});
      expect(missingResponse.status).toBe(400);
      expect(missingResponse.body.message).toBe("Provide a valid email address!");

      const invalidResponse = await request(app)
        .post("/api/auth/verify-email")
        .send({ email: "invalid-email" });
      expect(invalidResponse.status).toBe(400);
      expect(invalidResponse.body.message).toBe("Provide a valid email address!");
    });

    test("returns 404 if email does not exist", async () => {
      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({ email: "notfound@example.com" });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("No account found with this email!");
    });

    test("returns 200 if email exists", async () => {
      await createUser({ email: "exists@example.com" });
      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({ email: "exists@example.com" });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("Email verified successfully.");
    });
  });

  describe("POST /api/auth/reset-password", () => {
    test("rejects invalid email or weak password", async () => {
      const invalidEmailResponse = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: "bad-email", password: validPassword });
      expect(invalidEmailResponse.status).toBe(400);
      expect(invalidEmailResponse.body.message).toBe("Provide a valid email address!");

      const weakPasswordResponse = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: "user@example.com", password: "123" });
      expect(weakPasswordResponse.status).toBe(400);
      expect(weakPasswordResponse.body.message).toContain(
        "Use a valid password with at least 8 characters",
      );
    });

    test("returns 404 for nonexistent email", async () => {
      const response = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: "missing@example.com", password: "NewPassword1!" });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("User not found!");
    });

    test("successfully updates password and invalidates previous credentials", async () => {
      const user = await createUser({ email: "resetme@example.com" });
      const newPassword = "UpdatedPassword1@";

      const resetResponse = await request(app)
        .post("/api/auth/reset-password")
        .send({ email: "resetme@example.com", password: newPassword });
      expect(resetResponse.status).toBe(200);
      expect(resetResponse.body.message).toBe("Password updated successfully.");

      // Login with old password should fail
      const oldLoginResponse = await request(app)
        .post("/api/auth")
        .send({ email: "resetme@example.com", password: validPassword });
      expect(oldLoginResponse.status).toBe(400);

      // Login with new password should succeed
      const newLoginResponse = await request(app)
        .post("/api/auth")
        .send({ email: "resetme@example.com", password: newPassword });
      expect(newLoginResponse.status).toBe(200);
      expect(newLoginResponse.headers["x-auth-token"]).toBeTruthy();
    });
  });
});
