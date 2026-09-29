const mongoose = require("mongoose");
const Joi = require("joi");

const userSnapshotSchema = new mongoose.Schema(
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

const heroSlideSchema = new mongoose.Schema(
  {
    eyebrow: {
      type: String,
      trim: true,
      default: "",
      maxlength: 80,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: 240,
    },
    actionLabel: {
      type: String,
      trim: true,
      default: "Explore now",
      maxlength: 40,
    },
    href: {
      type: String,
      trim: true,
      default: "/catalog",
    },
    imageURL: {
      type: String,
      required: true,
      trim: true,
    },
    imagePublicId: {
      type: String,
      trim: true,
      default: "",
    },
    alt: {
      type: String,
      trim: true,
      default: "Featured hardware",
      maxlength: 160,
    },
    accentTheme: {
      type: String,
      enum: ["navy", "slate", "charcoal"],
      default: "navy",
    },
    sortOrder: {
      type: Number,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: userSnapshotSchema,
    updatedBy: userSnapshotSchema,
  },
  { timestamps: true },
);

const slideValidation = Joi.object({
  eyebrow: Joi.string().trim().max(80).allow("").default(""),
  title: Joi.string().trim().min(5).max(100).required(),
  description: Joi.string().trim().max(240).allow("").default(""),
  actionLabel: Joi.string().trim().max(40).allow("").default("Explore now"),
  href: Joi.string()
    .trim()
    .pattern(/^(\/|https?:\/\/)/)
    .default("/catalog"),
  imageURL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .required(),
  imagePublicId: Joi.string().trim().allow("").default(""),
  alt: Joi.string().trim().max(160).allow("").default("Featured hardware"),
  accentTheme: Joi.string().valid("navy", "slate", "charcoal").default("navy"),
  sortOrder: Joi.number().integer().min(0).default(0),
  isActive: Joi.boolean().default(true),
});

function validateSlide(payload) {
  return slideValidation.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
}

const HeroSlide = mongoose.model("HeroSlide", heroSlideSchema);

exports.HeroSlide = HeroSlide;
exports.validateSlide = validateSlide;
