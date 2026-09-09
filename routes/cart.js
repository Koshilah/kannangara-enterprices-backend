const express = require("express");
const route = express.Router();
const auth = require("../middleware/auth");
const Cart = require("../models/cart");
//const { Product } = require("../models/product");

route.post("/", auth, async (req, res) => {
  const { productID } = req.body;

  if (!productID) {
    return res.status(400).send({
      success: false,
      message: "productID is required",
    });
  }

  try {
    //const product = await Product.findById(productID);

    //if (!product) {
    //  return res.status(404).send({
    //    success: false,
    //    message: "Product not found",
    //  });
    //}

    let cart = await Cart.findOne({ userId: req.user.id });

    if (!cart) {
      cart = new Cart({
        userId: req.user.id,
        items: [{ productId: productID, quantity: 1 }],
      });

      await cart.save();

      return res.status(201).send({
        success: true,
        message: "Cart created successfully",
        data: cart,
      });
    }

    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productID,
    );

    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      cart.items.push({ productId: productID, quantity: 1 });
    }

    await cart.save();

    res.send({
      success: true,
      message: "Cart updated successfully",
      data: cart,
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/", auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.id });

    if (!cart) {
      return res.send({ success: true, data: [] });
    }

    res.send({ success: true, data: cart });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/count", auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.id });

    if (!cart) {
      return res.send({ success: true, data: 0 });
    }

    const totalQuantity = cart.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    res.send({ success: true, data: totalQuantity });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.delete("/:productID", auth, async (req, res) => {
  const { productID } = req.params;

  if (!productID) {
    return res.status(400).send({
      success: false,
      message: "ProductID is required",
    });
  }

  try {
    const cart = await Cart.findOne({ userId: req.user.id });

    if (!cart) {
      return res.status(404).send({
        success: false,
        message: "Cart not found",
      });
    }

    const itemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productID,
    );

    if (itemIndex === -1) {
      return res.status(404).send({
        success: false,
        message: "Product not found in cart",
      });
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();

    return res.send({
      success: true,
      message: "Cart item removed successfully",
      data: cart,
    });
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.patch("/", auth, async (req, res) => {
  const { productID, updatedQuantity } = req.body;

  if (!productID) {
    return res.status(400).send({
      success: false,
      message: "ProductID is required",
    });
  }

  if (
    updatedQuantity !== undefined &&
    (!Number.isInteger(updatedQuantity) || updatedQuantity < 1)
  ) {
    return res.status(400).send({
      success: false,
      message: "updatedQuantity must be an integer greater than zero",
    });
  }

  try {
    const cart = await Cart.findOne({ userId: req.user.id });

    if (!cart) {
      return res.status(404).send({
        success: false,
        message: "Cart not found",
      });
    }

    const existingItem = cart.items.find(
      (item) => item.productId.toString() === productID,
    );

    if (!existingItem) {
      return res.status(404).send({
        success: false,
        message: "Product not found in cart",
      });
    }

    if (updatedQuantity !== undefined) {
      existingItem.quantity = updatedQuantity;
    } else {
      existingItem.quantity += 1;
    }

    await cart.save();

    res.send({
      success: true,
      message: "Cart item quantity updated successfully",
      data: cart,
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

module.exports = route;
