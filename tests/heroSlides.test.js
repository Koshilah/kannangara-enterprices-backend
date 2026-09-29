const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const { HeroSlide } = require("../models/heroSlide");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
  return User.create({
    name: "Hero Slide Test User",
    email: `hero-slide-${Date.now()}-${Math.random()}@example.com`,
    password: await bcrypt.hash(validPassword, 10),
    ...overrides,
  });
}

function authorizationFor(user) {
  return `Bearer ${signAccessToken(user)}`;
}

function slidePayload(overrides = {}) {
  return {
    eyebrow: "Build with confidence",
    title: "The right tools for every project.",
    description: "Quality hardware for your next project.",
    actionLabel: "Shop hardware",
    href: "/catalog",
    imageURL: "https://example.com/hero.jpg",
    imagePublicId: "",
    alt: "Tools on a workbench",
    accentTheme: "navy",
    sortOrder: 1,
    isActive: true,
    ...overrides,
  };
}

describe("hero slide routes", () => {
  let adminAuthorization;
  let managerAuthorization;
  let cashierAuthorization;

  beforeAll(async () => {
    await connectDatabase(mongodbTestUri, {
      serverSelectionTimeoutMS: 3000,
    });
  }, 10000);

  beforeEach(async () => {
    await Promise.all([HeroSlide.deleteMany({}), User.deleteMany({})]);

    const admin = await createUser({
      email: "hero-admin@example.com",
      isAdmin: true,
    });
    const manager = await createUser({
      email: "hero-manager@example.com",
      isAdmin: true,
      isMannager: true,
    });
    const cashier = await createUser({
      email: "hero-cashier@example.com",
      isCashier: true,
    });

    adminAuthorization = authorizationFor(admin);
    managerAuthorization = authorizationFor(manager);
    cashierAuthorization = authorizationFor(cashier);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }, 10000);

  test("returns active slides sorted by display order", async () => {
    await HeroSlide.create([
      slidePayload({ title: "Second slide", sortOrder: 2 }),
      slidePayload({
        title: "Hidden slide",
        sortOrder: 0,
        isActive: false,
      }),
      slidePayload({ title: "First slide", sortOrder: 1 }),
    ]);

    const response = await request(app).get("/api/hero-slide");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.map((slide) => slide.title)).toEqual([
      "First slide",
      "Second slide",
    ]);
  });

  test("requires catalog access for management endpoints", async () => {
    const unauthenticatedResponse = await request(app).get(
      "/api/hero-slide/manage",
    );
    expect(unauthenticatedResponse.status).toBe(401);

    const cashierResponse = await request(app)
      .post("/api/hero-slide")
      .set("Authorization", cashierAuthorization)
      .send(slidePayload());
    expect(cashierResponse.status).toBe(403);
  });

  test("allows managers to create and update slides", async () => {
    const createResponse = await request(app)
      .post("/api/hero-slide")
      .set("Authorization", managerAuthorization)
      .send(slidePayload());

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.createdBy.name).toBe(
      "Hero Slide Test User",
    );

    const updateResponse = await request(app)
      .put(`/api/hero-slide/${createResponse.body.data._id}`)
      .set("Authorization", adminAuthorization)
      .send(slidePayload({ title: "Updated hero slide", isActive: false }));

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.title).toBe("Updated hero slide");
    expect(updateResponse.body.data.isActive).toBe(false);
  });

  test("rejects invalid slide data and supports deletion", async () => {
    const invalidResponse = await request(app)
      .post("/api/hero-slide")
      .set("Authorization", adminAuthorization)
      .send({ title: "Bad" });

    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.success).toBe(false);

    const slide = await HeroSlide.create(slidePayload());
    const deleteResponse = await request(app)
      .delete(`/api/hero-slide/${slide._id}`)
      .set("Authorization", adminAuthorization);

    expect(deleteResponse.status).toBe(200);
    expect(await HeroSlide.findById(slide._id)).toBeNull();
  });
});
