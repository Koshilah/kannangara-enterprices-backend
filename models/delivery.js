const mongoose = require("mongoose");

const DELIVERY_STATUSES = [
  "pending",
  "processing",
  "out_for_delivery",
  "delivered",
  "cancelled",
];

const deliverySchema = new mongoose.Schema(
  {
    orderID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    userID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deliveryAddress: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: "pending",
    },
    dueDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

const Delivery = mongoose.model("Delivery", deliverySchema);

exports.Delivery = Delivery;
exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
