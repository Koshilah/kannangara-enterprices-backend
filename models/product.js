const mongoose = require("mongoose");
const Joi = require("joi");

const addedBySchema = new mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: [String],
      default: [],
    },
    price: {
      type: Number,
      required: true,
    },
    discountPrice: {
      type: Number,
      default: 0,
    },
    imageURL: {
      type: String,
      trim: true,
    },
    totalStock: {
      type: Number,
      default: 0,
    },
    outOfStock: {
      type: Boolean,
      default: false,
    },
    visibility: {
      type: Boolean,
      default: true,
    },
    addedBy: addedBySchema,
  },
  { timestamps: true },
);

const inputValidation = (req) => {
  const schema = Joi.object({
    title: Joi.string().min(5).max(40).required(),
    description: Joi.string().min(10).max(500).required(),
    category: Joi.array().items(Joi.string()),
    price: Joi.number().required(),
    discountPrice: Joi.number().default(0),
    imageURL: Joi.string().trim(),
    totalStock: Joi.number().default(0),
    outOfStock: Joi.boolean().default(false),
    visibility: Joi.boolean().default(true),
  });

  const { error } = schema.validate(req);
  return error;
};

const Product = mongoose.model("Product", productSchema);

exports.Product = Product;
exports.inputValidation = inputValidation;
