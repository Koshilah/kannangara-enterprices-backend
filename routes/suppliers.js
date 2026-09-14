const express = require("express");
const mongoose = require("mongoose");
const Joi = require("joi");
const Supplier = require("../models/supplier");
const { Product } = require("../models/product");
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

const route = express.Router();

const supplierFields = {
  representativeName: Joi.string().trim().min(2).max(100),
  companyName: Joi.string().trim().min(2).max(150),
  phoneNumber: Joi.string().trim().min(3).max(30),
  email: Joi.string().trim().email(),
  address: Joi.string().trim().min(2).max(300),
  products: Joi.array().items(Joi.string()).unique(),
};

const createSupplierSchema = Joi.object({
  ...supplierFields,
  representativeName: supplierFields.representativeName.required(),
  companyName: supplierFields.companyName.required(),
  phoneNumber: supplierFields.phoneNumber.required(),
  email: supplierFields.email.required(),
  address: supplierFields.address.required(),
  products: supplierFields.products.default([]),
});

const updateSupplierSchema = Joi.object(supplierFields).min(1);

const productSelection = {
  path: "products",
  select: "title imageURL",
};

async function validateProductIds(productIds) {
  const uniqueProductIds = [...new Set(productIds)];

  if (uniqueProductIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    return { error: "One or more product IDs are invalid" };
  }

  const products = await Product.find({ _id: { $in: uniqueProductIds } })
    .select("_id")
    .lean();

  if (products.length !== uniqueProductIds.length) {
    return { error: "One or more products were not found" };
  }

  return { productIds: uniqueProductIds };
}

function sendValidationError(res, error) {
  return res.status(400).send({
    success: false,
    message: "Invalid supplier data",
    error: error.details,
  });
}

//get all
route.get("/", [auth, admin], async (req, res) => {
  try {
    const suppliers = await Supplier.find()
      .populate(productSelection)
      .sort({ createdAt: -1 });

    return res.send({ success: true, data: suppliers });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading suppliers",
    });
  }
});


route.get("/by-product/:productId", [auth, admin], async (req, res) => {
  const { productId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid product document id",
    });
  }

  try {
    const suppliers = await Supplier.find({ products: productId })
      .populate(productSelection)
      .sort({ createdAt: -1 });

    return res.send({ success: true, data: suppliers });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while finding suppliers",
    });
  }
});

route.post("/", [auth, admin], async (req, res) => {
  const { error, value } = createSupplierSchema.validate(req.body, {
    abortEarly: false,
  });

  if (error) return sendValidationError(res, error);

  try {
    const productResult = await validateProductIds(value.products);
    if (productResult.error) {
      return res
        .status(400)
        .send({ success: false, message: productResult.error });
    }

    const supplier = await Supplier.create({
      ...value,
      products: productResult.productIds,
    });
    await supplier.populate(productSelection);

    return res.status(201).send({
      success: true,
      message: "Supplier added successfully",
      data: supplier,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while adding supplier",
    });
  }
});

route.put("/:supplierId", [auth, admin], async (req, res) => {
  const { supplierId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(supplierId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid supplier document id",
    });
  }

  const { error, value } = updateSupplierSchema.validate(req.body, {
    abortEarly: false,
  });

  if (error) return sendValidationError(res, error);

  try {
    if (value.products !== undefined) {
      const productResult = await validateProductIds(value.products);
      if (productResult.error) {
        return res
          .status(400)
          .send({ success: false, message: productResult.error });
      }
      value.products = productResult.productIds;
    }

    const supplier = await Supplier.findByIdAndUpdate(supplierId, value, {
      new: true,
      runValidators: true,
    }).populate(productSelection);

    if (!supplier) {
      return res
        .status(404)
        .send({ success: false, message: "Supplier not found" });
    }

    return res.send({
      success: true,
      message: "Supplier updated successfully",
      data: supplier,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while updating supplier",
    });
  }
});

route.delete("/:supplierId", [auth, admin], async (req, res) => {
  const { supplierId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(supplierId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid supplier document id",
    });
  }

  try {
    const supplier = await Supplier.findByIdAndDelete(supplierId);

    if (!supplier) {
      return res
        .status(404)
        .send({ success: false, message: "Supplier not found" });
    }

    return res.send({
      success: true,
      message: "Supplier deleted successfully",
      data: supplier,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while deleting supplier",
    });
  }
});

module.exports = route;
