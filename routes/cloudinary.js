const express = require("express");
const route = express.Router();
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const auth = require("../middleware/auth");
const catalog = require("../middleware/catalog");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const tags = ["kannangara-e-commerce"];

route.post("/", [auth, catalog, upload.single("image")], async (req, res) => {

  try {
    if (!req.file) {
      return res.status(400).send({
        success: false,
        message: "File not received!",
      });
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { tags },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );

      stream.end(req.file.buffer);
    });

    return res.send({
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).send({
      success: false,
      message: "Failed to upload image",
    });
  }
});

module.exports = route;
