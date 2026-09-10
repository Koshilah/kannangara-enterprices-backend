const express = require("express");
const mongoose = require("mongoose");
const route = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const Cart = require("../models/cart");
const Order = require("../models/order");
const { Delivery } = require("../models/delivery");
const { Product } = require("../models/product");

route.post("/", auth, async (req, res) => {
  const { cartID, paymentMethod, deliveryAddress } = req.body;

  if (!cartID || !paymentMethod || !deliveryAddress) {
    return res.status(400).send({
      success: false,
      message: "cartID, paymentMethod and deliveryAddress are required",
    });
  }

  let session;

  try {
    const cart = await Cart.findOne({ _id: cartID, userId: req.user.id });

    if (!cart) {
      return res.status(404).send({
        success: false,
        message: "Cart not found",
      });
    }

    if (!cart.items || cart.items.length === 0) {
      return res.status(400).send({
        success: false,
        message: "Cart is empty",
      });
    }

    const orderItems = [];
    let orderTotal = 0;

    for (const item of cart.items) {
      const product = await Product.findById(item.productId);

      if (!product) {
        continue;
      }

      const price =
        product.discountPrice && product.discountPrice !== 0
          ? product.discountPrice
          : product.price;

      const priceTotal = price * item.quantity;

      orderTotal += priceTotal;

      orderItems.push({
        productID: product._id,
        title: product.title,
        priceSingle: price,
        quantity: item.quantity,
        imageURL: product.imageURL,
        priceTotal,
      });
    }

    const order = new Order({
      userID: req.user.id,
      items: orderItems,
      orderTotal,
      paymentMethod,
      paymentStatus: "pending",
      deliveryAddress,
      paymentID: "",
    });

    session = await mongoose.startSession();
    session.startTransaction();

    await order.save({ session });

    const dueDate = new Date(order.dateOrdered);
    dueDate.setDate(dueDate.getDate() + 3);

    const delivery = new Delivery({
      orderID: order._id,
      userID: req.user.id,
      deliveryAddress,
      dueDate,
    });

    await delivery.save({ session });
    await session.commitTransaction();

    res.status(201).send({
      success: true,
      message: "Order created successfully",
      data: order,
    });
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  } finally {
    await session?.endSession();
  }
});

route.patch("/", [auth, admin], async (req, res) => {
  const { orderID, orderStatus } = req.body;

  if (!orderID || !orderStatus) {
    return res.status(400).send({
      success: false,
      message: "orderID and orderStatus are required",
    });
  }

  try {
    const order = await Order.findByIdAndUpdate(
      orderID,
      { orderStatus },
      { new: true },
    );

    if (!order) {
      return res.status(404).send({
        success: false,
        message: "Order not found",
      });
    }

    res.send({
      success: true,
      message: "Order status updated successfully",
      data: order,
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

module.exports = route;
