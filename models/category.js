const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
    },
    parentID: {
      type: mongoose.ObjectId,
      default: null,
    },
    visibility: {
        type: Boolean,
        default: true,
    },
  },
  { timestamps: true },
);

const Category = mongoose.model('category', categorySchema);

exports.Category = Category;