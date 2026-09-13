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
  const {
    cartID,
    paymentMethod,
    deliveryAddress,
    orderType = "delivery",
  } = req.body;

  if (!paymentMethod) {
    return res.status(400).send({
      success: false,
      message: "paymentMethod is required",
    });
  }

  if (orderType === "delivery" && !deliveryAddress) {
    return res.status(400).send({
      success: false,
      message: "deliveryAddress is required for delivery orders",
    });
  }

  const finalDeliveryAddress =
    orderType === "pickup"
      ? deliveryAddress || "Store Pickup (Kannangara Enterprises)"
      : deliveryAddress;

  let session;

  try {
    let cart = null;
    if (cartID && isValidObjectId(cartID)) {
      cart = await Cart.findOne({ _id: cartID, userId: req.user.id });
    }

    if (!cart) {
      cart = await Cart.findOne({ userId: req.user.id });
    }

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
      let product = null;
      if (isValidObjectId(item.productId)) {
        product = await Product.findById(item.productId);
      }

      let price = 0;
      let title = "Product";
      let imageURL = "";

      if (product) {
        price =
          product.discountPrice && product.discountPrice !== 0
            ? product.discountPrice
            : product.price;
        title = product.title;
        imageURL = product.imageURL;
      } else {
        price = Number(item.discountPrice || item.price || 0);
        title = item.title || "Product";
        imageURL = item.imageURL || "";
      }

      const quantity = Number(item.quantity) || 1;
      const priceTotal = price * quantity;

      orderTotal += priceTotal;

      const productID = product
        ? product._id
        : isValidObjectId(item.productId)
          ? item.productId
          : new mongoose.Types.ObjectId();

      orderItems.push({
        productID,
        title,
        priceSingle: price,
        quantity,
        imageURL,
        priceTotal,
      });
    }

    const isOnlinePayment = !paymentMethod?.toLowerCase().includes("cash");
    const paymentStatus = isOnlinePayment ? "successful" : "pending";
    const paymentID = isOnlinePayment
      ? "PAY-" +
        new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()
      : "";

    const order = new Order({
      userID: req.user.id,
      items: orderItems,
      orderTotal,
      orderType,
      paymentMethod,
      paymentStatus,
      orderStatus: "successful",
      paidAt: isOnlinePayment ? new Date() : undefined,
      deliveryAddress: finalDeliveryAddress,
      paymentID,
    });

    session = await mongoose.startSession();
    session.startTransaction();

    await order.save({ session });

    if (orderType === "delivery") {
      const dueDate = new Date(order.dateOrdered);
      dueDate.setDate(dueDate.getDate() + 3);

      const delivery = new Delivery({
        orderID: order._id,
        userID: req.user.id,
        deliveryAddress: finalDeliveryAddress,
        dueDate,
      });

      await delivery.save({ session });
    }

    // Empty the user's cart upon order placement
    cart.items = [];
    await cart.save({ session });

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

route.get("/my-orders", auth, async (req, res) => {
  try {
    const orders = await Order.find({ userID: req.user.id }).sort({
      dateOrdered: -1,
      createdAt: -1,
    });

    return res.send({ success: true, data: orders });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading customer orders",
    });
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
