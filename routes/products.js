const express = require("express");
const route = express.Router();
const { Product, inputValidation } = require("../models/product");
const { User } = require("../models/user");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

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
    const products = await Product.find({ outOfStock: true }).sort({ createdAt: -1 });

    res.send({ success: true, data: products });
  } catch (error) {
    res.status(500).send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/category/:categoryId", async (req, res) => {
  try {
    const products = await Product.find({
      category: { $in: [req.params.categoryId] },
    }).sort({ createdAt: -1 });

    res.send({ success: true, data: products });
  } catch (error) {
    res.status(500).send({ success: false, message: "Error occured: " + error });
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

route.put("/:id", [auth, admin], async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product)
      return res.status(404).send({
        success: false,
        message: "Product not found",
      });

    product.title = req.body.title || product.title;
    product.description = req.body.description || product.description;
    product.category = req.body.category || product.category;
    product.price = req.body.price || product.price;
    product.discountPrice = req.body.discountPrice || product.discountPrice;
    product.imageURL = req.body.imageURL || product.imageURL;
    product.totalStock = req.body.totalStock || product.totalStock;
    product.outOfStock = req.body.outOfStock || product.outOfStock;
    product.visibility = req.body.visibility || product.visibility;

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

route.delete("/:id", [auth, admin], async (req, res) => {
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
    res.status(500).send({ success: false, message: "Error occured: " + error });
  }
});

route.post("/", [auth, admin], async (req, res) => {
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
