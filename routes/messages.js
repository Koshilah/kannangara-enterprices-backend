const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const management = require("../middleware/management");
const Message = require("../models/message");

const route = express.Router();

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    return `${field} is required`;
  }

  if (value.trim().length > maxLength) {
    return `${field} must be ${maxLength} characters or fewer`;
  }

  return null;
}

route.post("/", async (req, res) => {
  const { name, email, subject, message } = req.body;
  const validationError =
    requiredText(name, "name", 100) ||
    requiredText(email, "email", 254) ||
    requiredText(subject, "subject", 160) ||
    requiredText(message, "message", 5000);

  if (validationError) {
    return res.status(400).send({ success: false, message: validationError });
  }

  if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
    return res.status(400).send({
      success: false,
      message: "email must be a valid email address",
    });
  }

  try {
    const createdMessage = await Message.create({
      name: name.trim(),
      email: email.trim(),
      subject: subject.trim(),
      message: message.trim(),
    });

    return res.status(201).send({
      success: true,
      message: "Message sent successfully",
      data: createdMessage,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while sending message",
    });
  }
});

route.get("/", [auth, management], async (req, res) => {
  try {
    const messages = await Message.find().sort({ createdAt: -1 });
    return res.send({ success: true, data: messages });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading messages",
    });
  }
});

route.get("/unread-count", [auth, management], async (req, res) => {
  try {
    const count = await Message.countDocuments({ isRead: false });
    return res.send({ success: true, data: { count } });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading unread messages",
    });
  }
});

route.patch("/:messageId/read", [auth, management], async (req, res) => {
  const { messageId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid message document id",
    });
  }

  try {
    const updatedMessage = await Message.findByIdAndUpdate(
      messageId,
      { isRead: true, readAt: new Date() },
      { new: true },
    );

    if (!updatedMessage) {
      return res.status(404).send({
        success: false,
        message: "Message not found",
      });
    }

    return res.send({
      success: true,
      message: "Message marked as read",
      data: updatedMessage,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while marking message as read",
    });
  }
});

route.delete("/:messageId", [auth, management], async (req, res) => {
  const { messageId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid message document id",
    });
  }

  try {
    const deletedMessage = await Message.findByIdAndDelete(messageId);

    if (!deletedMessage) {
      return res.status(404).send({
        success: false,
        message: "Message not found",
      });
    }

    return res.send({
      success: true,
      message: "Message deleted successfully",
      data: deletedMessage,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while deleting message",
    });
  }
});

module.exports = route;
