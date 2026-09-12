const express = require("express");
const mongoose = require("mongoose");
const route = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const Cart = require("../models/cart");
const Order = require("../models/order");
const { Delivery } = require("../models/delivery");
const { Product } = require("../models/product");

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

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

route.get("/", [auth, admin], async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("userID", "name email")
      .sort({ dateOrdered: -1, createdAt: -1 });

    return res.send({ success: true, data: orders });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading orders",
    });
  }
});

route.get("/:orderID", [auth, admin], async (req, res) => {
  const { orderID } = req.params;

  if (!isValidObjectId(orderID)) {
    return res.status(400).send({
      success: false,
      message: "Invalid order id",
    });
  }

  try {
    const order = await Order.findById(orderID).populate(
      "userID",
      "name email",
    );
    if (!order) {
      return res
        .status(404)
        .send({ success: false, message: "Order not found" });
    }

    const delivery = await Delivery.findOne({ orderID });
    return res.send({ success: true, data: { order, delivery } });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading order details",
    });
  }
});

route.patch("/:orderID/cancel", [auth, admin], async (req, res) => {
  const { orderID } = req.params;

  if (!isValidObjectId(orderID)) {
    return res.status(400).send({
      success: false,
      message: "Invalid order id",
    });
  }

  let session;

  try {
    const order = await Order.findById(orderID);
    if (!order) {
      return res
        .status(404)
        .send({ success: false, message: "Order not found" });
    }

    if (["cancelled", "delivered"].includes(order.orderStatus)) {
      return res.status(409).send({
        success: false,
        message: `A ${order.orderStatus} order cannot be cancelled`,
      });
    }

    session = await mongoose.startSession();
    session.startTransaction();

    order.orderStatus = "cancelled";
    await order.save({ session });

    const delivery = await Delivery.findOneAndUpdate(
      { orderID },
      { status: "cancelled" },
      { new: true, session, runValidators: true },
    );

    await session.commitTransaction();
    return res.send({
      success: true,
      message: "Order cancelled successfully",
      data: { order, delivery },
    });
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    return res.status(500).send({
      success: false,
      message: "Error occurred while cancelling order",
    });
  } finally {
    await session?.endSession();
  }
});

route.patch("/:orderID/payment", [auth, admin], async (req, res) => {
  const { orderID } = req.params;
  const { paymentStatus } = req.body;
  const allowedStatuses = ["pending", "paid", "failed", "refunded"];

  if (!isValidObjectId(orderID)) {
    return res
      .status(400)
      .send({ success: false, message: "Invalid order id" });
  }

  if (!allowedStatuses.includes(paymentStatus)) {
    return res.status(400).send({
      success: false,
      message: "paymentStatus must be pending, paid, failed, or refunded",
    });
  }

  try {
    const order = await Order.findById(orderID);
    if (!order) {
      return res
        .status(404)
        .send({ success: false, message: "Order not found" });
    }

    order.paymentStatus = paymentStatus;
    order.paidAt = paymentStatus === "paid" ? new Date() : undefined;
    await order.save();

    return res.send({
      success: true,
      message: "Payment status updated successfully",
      data: order,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while updating payment status",
    });
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
