const express = require("express");
const route = express.Router();
const mongoose = require("mongoose");
const _ = require("lodash");
const slugify = require("slugify");
const { Category } = require("../models/category");
const auth = require("../middleware/auth");
const catalog = require("../middleware/catalog");

route.get("/", async (req, res) => {
  try {
    const categories = await Category.find({}).sort({ name: 1 });

    const formattedCategories = categories
      .filter((category) => !category.parentID)
      .map((parentCategory) => {
        const subCategories = categories.filter((category) => {
          const parentId = category.parentID;
          return (
            parentId && parentId.toString() === parentCategory._id.toString()
          );
        });

        return {
          ...parentCategory.toObject(),
          subCategories,
        };
      });

    res.send({ success: true, data: formattedCategories });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/parents", async (req, res) => {
  try {
    const parentCategories = await Category.find({ parentID: null }).sort({
      name: 1,
    });

    res.send({ success: true, data: parentCategories });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.post("/", [auth, catalog], async (req, res) => {
  if (!req.body.name)
    return res
      .status(400)
      .send({ success: false, message: "Provide a name for category" });

  if (req.body.parentID && !mongoose.Types.ObjectId.isValid(req.body.parentID))
    return res
      .status(400)
      .send({ success: false, message: "Provide a valid category-ID" });

  try {
    if (req.body.parentID) {
      const existingParent = await Category.findById(req.body.parentID);
      if (!existingParent)
        return res.status(400).send({
          success: false,
          message: "Provide a valid parent category-ID",
        });
    }

    const newcategory = new Category(
      _.pick(req.body, ["name", "parentID", "visibility"]),
    );
    newcategory.slug = slugify(req.body.name, { lower: true });

    await newcategory.save();
    res.send({
      success: true,
      message: "Category added successfully!",
      data: newcategory,
    });
  } catch (error) {
    res.status(500).send("Error occured: " + error);
  }
});

route.put("/:id/toggle-visibility", [auth, catalog], async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category)
      return res.status(404).send({
        success: false,
        message: "Category not found",
      });

    category.visibility = !category.visibility;
    await category.save();

    res.send({
      success: true,
      message: "Category visibility updated successfully"
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

module.exports = route;
