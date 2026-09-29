const express = require("express");
const mongoose = require("mongoose");
const route = express.Router();
const { Product, inputValidation } = require("../models/product");
const { Category } = require("../models/category");
const { User } = require("../models/user");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const inventory = require("../middleware/inventory");
const catalog = require("../middleware/catalog");

route.get("/", async (req, res) => {
  try {
    const products = await Product.find({}).sort({ createdAt: -1 });

    res.send({ success: true, data: products });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/out-of-stock", [auth, admin], async (req, res) => {
  try {
    const products = await Product.find({ outOfStock: true }).sort({
      createdAt: -1,
    });

    res.send({ success: true, data: products });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/category/:categoryId", async (req, res) => {
  try {
    const categoryIds = [req.params.categoryId];

    if (mongoose.Types.ObjectId.isValid(req.params.categoryId)) {
      const subcategories = await Category.find({
        parentID: req.params.categoryId,
      }).select("_id");
      categoryIds.push(
        ...subcategories.map((subcategory) => subcategory._id.toString()),
      );
    }

    const products = await Product.find({
      category: { $in: categoryIds },
    }).sort({ createdAt: -1 });

    res.send({ success: true, data: products });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });

    res.send({ success: true, data: product });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.patch("/:id/stock", [auth, inventory], async (req, res) => {
  const quantity = Number(req.body.totalStock);

  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).send({
      success: false,
      message: "Quantity must be a non-negative whole number",
    });
  }

  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { totalStock: quantity, outOfStock: quantity === 0 },
      { new: true, runValidators: true },
    );

    if (!product) {
      return res
        .status(404)
        .send({ success: false, message: "Product not found" });
    }

    return res.send({ success: true, data: product });
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: "Error occurred while updating stock" });
  }
});

route.put("/:id", [auth, catalog], async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });

    [
      "title",
      "description",
      "category",
      "price",
      "discountPrice",
      "imageURL",
      "totalStock",
      "outOfStock",
      "visibility",
    ].forEach((field) => {
      if (req.body[field] !== undefined) product[field] = req.body[field];
    });

    await product.save();

    res.send({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.delete("/:id", [auth, catalog], async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product)
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });

    res.send({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.post("/", [auth, catalog], async (req, res) => {
  const validationError = inputValidation(req.body);

  if (validationError)
    return res.status(400).send({
      success: false,
      message: "Invalid product data",
      error: validationError.details,
    });

  try {
    const adminUser = await User.findById(req.user.id);

    if (!adminUser)
      return res.status(404).send({
        success: false,
        message: "Admin not found",
      });

    const newProduct = new Product({
      title: req.body.title,
      description: req.body.description,
      category: req.body.category || [],
      price: req.body.price,
      discountPrice: req.body.discountPrice,
      imageURL: req.body.imageURL,
      totalStock: req.body.totalStock,
      outOfStock: req.body.outOfStock,
      visibility: req.body.visibility,
      addedBy: {
        _id: adminUser._id,
        name: adminUser.name,
      },
    });

    await newProduct.save();

    res.status(201).send({
      success: true,
      message: "Product added successfully",
      data: newProduct,
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

module.exports = route;
