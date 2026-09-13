const mongoose = require("mongoose");
const Joi = require("joi");

const addressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    houseNo: {
      type: String,
      required: true,
      trim: true,
    },
    street1: {
      type: String,
      required: true,
      trim: true,
    },
    street2: {
      type: String,
      trim: true,
      default: null,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    postalCode: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

const inputValidation = (req) => {
  const schema = Joi.object({
    houseNo: Joi.string().trim().required(),
    street1: Joi.string().trim().required(),
    street2: Joi.string().trim().allow(""),
    city: Joi.string().trim().required(),
    postalCode: Joi.string().trim().allow(""),
  });

  const { error } = schema.validate(req);
  return error;
};

const Address = mongoose.model("Address", addressSchema);

exports.Address = Address;
exports.inputValidation = inputValidation;
