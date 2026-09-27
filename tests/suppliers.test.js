const { mongodbTestUri } = require("./testConfig");
const request = require("supertest");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const app = require("../app");
const connectDatabase = require("../startup/db");
const Supplier = require("../models/supplier");
const { Product } = require("../models/product");
const { User } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");

const validPassword = "Password1!";

async function createUser(overrides = {}) {
	return User.create({
		name: "Supplier Test User",
		email: `supplier-${Date.now()}-${Math.random()}@example.com`,
		password: await bcrypt.hash(validPassword, 10),
		...overrides,
	});
}

function authorizationFor(user) {
	return `Bearer ${signAccessToken(user)}`;
}

async function createProduct(overrides = {}) {
	return Product.create({
		title: "Test Product",
		description: "A product used by supplier route tests",
		price: 100,
		imageURL: "https://example.com/product.jpg",
		...overrides,
	});
}

function supplierPayload(products = []) {
	return {
		representativeName: "Supplier Representative",
		companyName: "Test Supplies Ltd",
		phoneNumber: "0771234567",
		email: "supplier@example.com",
		address: "100 Test Street",
		products,
	};
}

describe("supplier routes", () => {
	let adminUser;
	let adminAuthorization;
	let normalAuthorization;

	beforeAll(async () => {
		await connectDatabase(mongodbTestUri, {
			serverSelectionTimeoutMS: 3000,
		});
	}, 10000);

	beforeEach(async () => {
		await Promise.all([
			Supplier.deleteMany({}),
			Product.deleteMany({}),
			User.deleteMany({}),
		]);

		adminUser = await createUser({
			email: "supplier-admin@example.com",
			isAdmin: true,
		});
		const normalUser = await createUser({ email: "supplier-user@example.com" });
		adminAuthorization = authorizationFor(adminUser);
		normalAuthorization = authorizationFor(normalUser);
	});

	afterAll(async () => {
		if (mongoose.connection.readyState === 1) {
			await mongoose.connection.dropDatabase();
		}
		await mongoose.disconnect();
	}, 10000);

	test("requires authentication", async () => {
		const response = await request(app).get("/api/supplier");

		expect(response.status).toBe(401);
	});

	test("allows only admins to access suppliers", async () => {
		const response = await request(app)
			.get("/api/supplier")
			.set("Authorization", normalAuthorization);

		expect(response.status).toBe(403);
	});

	test("returns an empty supplier list for an admin", async () => {
		const response = await request(app)
			.get("/api/supplier")
			.set("Authorization", adminAuthorization);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ success: true, data: [] });
	});

	test("creates a supplier and populates its products", async () => {
		const product = await createProduct();

		const response = await request(app)
			.post("/api/supplier")
			.set("Authorization", adminAuthorization)
			.send(supplierPayload([product._id.toString()]));

		expect(response.status).toBe(201);
		expect(response.body.success).toBe(true);
		expect(response.body.data.companyName).toBe("Test Supplies Ltd");
		expect(response.body.data.products[0]).toMatchObject({
			title: product.title,
			imageURL: product.imageURL,
		});
		expect(await Supplier.countDocuments()).toBe(1);
	});

	test("rejects invalid supplier data", async () => {
		const response = await request(app)
			.post("/api/supplier")
			.set("Authorization", adminAuthorization)
			.send({ companyName: "" });

		expect(response.status).toBe(400);
		expect(response.body.message).toBe("Invalid supplier data");
		expect(response.body.success).toBe(false);
	});

	test("rejects invalid or missing product references", async () => {
		const invalidIdResponse = await request(app)
			.post("/api/supplier")
			.set("Authorization", adminAuthorization)
			.send(supplierPayload(["not-an-object-id"]));
		expect(invalidIdResponse.status).toBe(400);
		expect(invalidIdResponse.body.message).toBe(
			"One or more product IDs are invalid",
		);

		const missingProductResponse = await request(app)
			.post("/api/supplier")
			.set("Authorization", adminAuthorization)
			.send(supplierPayload([new mongoose.Types.ObjectId().toString()]));
		expect(missingProductResponse.status).toBe(400);
		expect(missingProductResponse.body.message).toBe(
			"One or more products were not found",
		);
	});

	test("finds suppliers by product", async () => {
		const product = await createProduct({ title: "Linked Product" });
		await Supplier.create(supplierPayload([product._id]));

		const response = await request(app)
			.get(`/api/supplier/by-product/${product._id}`)
			.set("Authorization", adminAuthorization);

		expect(response.status).toBe(200);
		expect(response.body.data).toHaveLength(1);
		expect(response.body.data[0].products[0].title).toBe("Linked Product");
	});

	test("rejects invalid product and supplier IDs", async () => {
		const productResponse = await request(app)
			.get("/api/supplier/by-product/not-an-object-id")
			.set("Authorization", adminAuthorization);
		expect(productResponse.status).toBe(400);
		expect(productResponse.body.message).toBe("Invalid product document id");

		const updateResponse = await request(app)
			.put("/api/supplier/not-an-object-id")
			.set("Authorization", adminAuthorization)
			.send({ companyName: "Updated Company" });
		expect(updateResponse.status).toBe(400);
		expect(updateResponse.body.message).toBe("Invalid supplier document id");

		const deleteResponse = await request(app)
			.delete("/api/supplier/not-an-object-id")
			.set("Authorization", adminAuthorization);
		expect(deleteResponse.status).toBe(400);
		expect(deleteResponse.body.message).toBe("Invalid supplier document id");
	});

	test("updates an existing supplier", async () => {
		const supplier = await Supplier.create(supplierPayload());

		const response = await request(app)
			.put(`/api/supplier/${supplier._id}`)
			.set("Authorization", adminAuthorization)
			.send({ companyName: "Updated Supplies Ltd", phoneNumber: "0712345678" });

		expect(response.status).toBe(200);
		expect(response.body.message).toBe("Supplier updated successfully");
		expect(response.body.data.companyName).toBe("Updated Supplies Ltd");
		expect(response.body.data.phoneNumber).toBe("0712345678");
	});

	test("returns not found for missing supplier updates and deletes", async () => {
		const missingId = new mongoose.Types.ObjectId();

		const updateResponse = await request(app)
			.put(`/api/supplier/${missingId}`)
			.set("Authorization", adminAuthorization)
			.send({ companyName: "Missing Supplier" });
		expect(updateResponse.status).toBe(404);
		expect(updateResponse.body.message).toBe("Supplier not found");

		const deleteResponse = await request(app)
			.delete(`/api/supplier/${missingId}`)
			.set("Authorization", adminAuthorization);
		expect(deleteResponse.status).toBe(404);
		expect(deleteResponse.body.message).toBe("Supplier not found");
	});

	test("deletes an existing supplier", async () => {
		const supplier = await Supplier.create(supplierPayload());

		const response = await request(app)
			.delete(`/api/supplier/${supplier._id}`)
			.set("Authorization", adminAuthorization);

		expect(response.status).toBe(200);
		expect(response.body.message).toBe("Supplier deleted successfully");
		expect(await Supplier.findById(supplier._id)).toBeNull();
	});
});
