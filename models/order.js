const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: [
      {
        productID: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        title: {
          type: String,
          required: true,
          trim: true,
        },
        priceSingle: {
          type: Number,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        imageURL: {
          type: String,
          trim: true,
        },
        priceTotal: {
          type: Number,
          required: true,
        },
      },
    ],
    orderTotal: {
      type: Number,
      required: true,
    },
    dateOrdered: {
      type: Date,
      default: Date.now,
    },
    orderStatus: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
      trim: true,
    },
    paidAt: {
      type: Date,
    },
    deliveryAddress: {
      type: String,
      trim: true,
    },
    paymentID: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

orderSchema.index({ paymentStatus: 1, dateOrdered: 1 });

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
