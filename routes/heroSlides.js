const express = require("express");
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const { HeroSlide, validateSlide } = require("../models/heroSlide");
const auth = require("../middleware/auth");
const catalog = require("../middleware/catalog");

const route = express.Router();

function actorSnapshot(req) {
  return {
    _id: req.user.id,
    name: req.user.name || "Unknown user",
  };
}

function invalidPayloadResponse(res, error) {
  return res.status(400).send({
    success: false,
    message: "Invalid hero slide data",
    error: error.details,
  });
}

async function removeCloudinaryAsset(publicID) {
  if (!publicID) return;

  try {
    await cloudinary.uploader.destroy(publicID);
  } catch (error) {
    console.error("Unable to remove hero slide image", error);
  }
}

route.get("/", async (req, res) => {
  try {
    const slides = await HeroSlide.find({ isActive: true }).sort({
      sortOrder: 1,
      createdAt: 1,
    });

    return res.send({ success: true, data: slides });
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: "Unable to load hero slides" });
  }
});

route.get("/manage", [auth, catalog], async (req, res) => {
  try {
    const slides = await HeroSlide.find({}).sort({
      sortOrder: 1,
      createdAt: 1,
    });

    return res.send({ success: true, data: slides });
  } catch (error) {
    return res
      .status(500)
      .send({ success: false, message: "Unable to load hero slides" });
  }
});

route.post("/", [auth, catalog], async (req, res) => {
  const { error, value } = validateSlide(req.body);
  if (error) return invalidPayloadResponse(res, error);

  try {
    const slide = await HeroSlide.create({
      ...value,
      createdBy: actorSnapshot(req),
      updatedBy: actorSnapshot(req),
    });

    return res.status(201).send({
      success: true,
      message: "Hero slide created successfully",
      data: slide,
    });
  } catch (createError) {
    return res
      .status(500)
      .send({ success: false, message: "Unable to create hero slide" });
  }
});

route.put("/:id", [auth, catalog], async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).send({
      success: false,
      message: "Invalid hero slide ID",
    });
  }

  try {
    const slide = await HeroSlide.findById(req.params.id);
    if (!slide) {
      return res
        .status(404)
        .send({ success: false, message: "Hero slide not found" });
    }

    const { error, value } = validateSlide({
      ...slide.toObject(),
      ...req.body,
    });
    if (error) return invalidPayloadResponse(res, error);

    const previousImagePublicId = slide.imagePublicId;
    Object.assign(slide, value, { updatedBy: actorSnapshot(req) });
    await slide.save();

    if (
      previousImagePublicId &&
      previousImagePublicId !== slide.imagePublicId
    ) {
      await removeCloudinaryAsset(previousImagePublicId);
    }

    return res.send({
      success: true,
      message: "Hero slide updated successfully",
      data: slide,
    });
  } catch (updateError) {
    return res
      .status(500)
      .send({ success: false, message: "Unable to update hero slide" });
  }
});

route.delete("/:id", [auth, catalog], async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).send({
      success: false,
      message: "Invalid hero slide ID",
    });
  }

  try {
    const slide = await HeroSlide.findByIdAndDelete(req.params.id);
    if (!slide) {
      return res
        .status(404)
        .send({ success: false, message: "Hero slide not found" });
    }

    await removeCloudinaryAsset(slide.imagePublicId);

    return res.send({
      success: true,
      message: "Hero slide deleted successfully",
    });
  } catch (deleteError) {
    return res
      .status(500)
      .send({ success: false, message: "Unable to delete hero slide" });
  }
});

module.exports = route;
