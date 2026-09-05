const mongoose = require("mongoose");
const Joi = require("joi");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minLength: 2,
      maxLength: 40,
    },
    email: {
      type: String,
      unique: true,
      minLength: 6,
      maxLength: 50,
      required: true,
    },
    password: {
      type: String,
      required: true,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    isMannager: {
      type: Boolean,
      default: false,
    },
    isCashier: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

userSchema.methods.generateJWT = function () {
  const token = jwt.sign(
    { _id: this.id, isAdmin: this.isAdmin, isMannager: this.isMannager, isCashier: this.isCashier },
    process.env.JWT_PRIVATE_KEY,
    { expiresIn: "15m" },
  );
  return token;
};

const inputValidation = (req) => {
  const schema = Joi.object({
    name: Joi.string().min(2).max(40).required(),
    email: Joi.string().email().min(6).max(50).required(),
    password: Joi.string()
      .pattern(new RegExp(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/))
      .required(),
    //isAdmin: Joi.boolean(),
    //isMannager: Joi.boolean(),
  });

  const { error } = schema.validate(req);
  return error;
};

const User = mongoose.model("User", userSchema);

exports.User = User;
exports.inputValidation = inputValidation;
