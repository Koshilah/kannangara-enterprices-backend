const express = require("express");
const mongoose = require("mongoose");
const route = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const { Delivery, DELIVERY_STATUSES } = require("../models/delivery");
const Order = require("../models/order");
const { auditRequest } = require("../utils/auditLogger");

route.get("/", [auth, admin], async (req, res) => {
  try {
    const deliveries = await Delivery.find()
      .populate("orderID")
      .populate("userID", "name email")
      .sort({ dueDate: 1, createdAt: -1 });

    return res.send({ success: true, data: deliveries });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading deliveries",
    });
  }
});

route.patch("/status", [auth, admin], async (req, res) => {
  const { deliveryID, status } = req.body;

  if (!deliveryID || !mongoose.Types.ObjectId.isValid(deliveryID)) {
    return res.status(400).send({
      success: false,
      message: "A valid deliveryID is required",
    });
  }

  if (!DELIVERY_STATUSES.includes(status)) {
    return res.status(400).send({
      success: false,
      message: `status must be one of: ${DELIVERY_STATUSES.join(", ")}`,
    });
  }

  try {
    const session = await mongoose.startSession();
    let delivery;
    const beforeDelivery = await Delivery.findById(deliveryID).select(
      "status dueDate orderID",
    );

    try {
      session.startTransaction();
      delivery = await Delivery.findByIdAndUpdate(
        deliveryID,
        { status },
        { new: true, runValidators: true, session },
      );

      if (delivery && status === "delivered") {
        const order = await Order.findById(delivery.orderID).session(session);

        if (order) {
          order.orderStatus = "completed";

          if (order.paymentMethod?.toLowerCase().includes("cash")) {
            order.paymentStatus = "paid";
            order.paidAt ||= new Date();
          }

          await order.save({ session });
        }
      }

      if (!delivery) {
        await session.abortTransaction();
      } else {
        await session.commitTransaction();
      }
    } finally {
      await session.endSession();
    }

    if (!delivery) {
      return res.status(404).send({
        success: false,
        message: "Delivery not found",
      });
    }

    auditRequest(req, res, {
      action: "DELIVERY_STATUS_UPDATED",
      targetResource: "Delivery",
      targetId: delivery._id,
      changes: {
        before: beforeDelivery,
        after: { status: delivery.status },
      },
    });

    return res.send({
      success: true,
      message: "Delivery status updated successfully",
      data: delivery,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while updating delivery status",
    });
  }
});

route.patch("/due-date", [auth, admin], async (req, res) => {
  const { deliveryID, dueDate } = req.body;

  if (!deliveryID || !mongoose.Types.ObjectId.isValid(deliveryID)) {
    return res.status(400).send({
      success: false,
      message: "A valid deliveryID is required",
    });
  }

  if (!dueDate || Number.isNaN(Date.parse(dueDate))) {
    return res.status(400).send({
      success: false,
      message: "dueDate must be a valid date",
    });
  }

  try {
    const beforeDelivery = await Delivery.findById(deliveryID).select(
      "dueDate status orderID",
    );
    const delivery = await Delivery.findByIdAndUpdate(
      deliveryID,
      { dueDate: new Date(dueDate) },
      { new: true, runValidators: true },
    );

    if (!delivery) {
      return res.status(404).send({
        success: false,
        message: "Delivery not found",
      });
    }

    auditRequest(req, res, {
      action: "DELIVERY_DUE_DATE_UPDATED",
      targetResource: "Delivery",
      targetId: delivery._id,
      changes: {
        before: beforeDelivery,
        after: { dueDate: delivery.dueDate },
      },
    });

    return res.send({
      success: true,
      message: "Delivery due date updated successfully",
      data: delivery,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while updating delivery due date",
    });
  }
});

route.delete("/:deliveryId", [auth, admin], async (req, res) => {
  const { deliveryId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid delivery document id",
    });
  }

  try {
    const delivery = await Delivery.findById(deliveryId);

    if (!delivery) {
      return res.status(404).send({
        success: false,
        message: "Delivery not found",
      });
    }

    if (delivery.status !== "delivered") {
      return res.status(409).send({
        success: false,
        message: "Only delivered deliveries can be deleted",
      });
    }

    await delivery.deleteOne();

    auditRequest(req, res, {
      action: "DELIVERY_DELETED",
      targetResource: "Delivery",
      targetId: delivery._id,
      changes: { before: delivery },
    });

    return res.send({
      success: true,
      message: "Delivery deleted successfully",
      data: delivery,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while deleting delivery",
    });
  }
});

module.exports = route;
