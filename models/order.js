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
        originalPriceSingle: {
          type: Number,
          default: 0,
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
        savingsTotal: {
          type: Number,
          default: 0,
        },
      },
    ],
    subtotal: {
      type: Number,
      default: 0,
    },
    totalSavings: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    orderTotal: {
      type: Number,
      required: true,
    },
    dateOrdered: {
      type: Date,
      default: Date.now,
    },
    orderType: {
      type: String,
      enum: ["delivery", "pickup"],
      default: "delivery",
    },
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "successful",
      ],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "successful"],
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
    estimatedDeliveryDate: {
      type: Date,
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
