const express = require("express");
const route = express.Router();
const auth = require("../middleware/auth");
const { Address, inputValidation } = require("../models/address");
const { User } = require("../models/user");

route.post("/", auth, async (req, res) => {
  const validationError = inputValidation(req.body);

  if (validationError)
    return res.status(400).send({
      success: false,
      message: "Invalid address data",
      error: validationError.details[0].message,
    });

  try {
    const user = await User.findById(req.user.id);

    if (!user)
      return res.status(404).send({
        success: false,
        message: "User not found",
      });

    const newAddress = new Address({
      ...req.body,
      userId: req.user.id,
      name: user.name,
    });

    await newAddress.save();

    res.status(201).send({
      success: true,
      message: "Address added successfully",
      data: newAddress,
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.get("/", auth, async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user.id }).sort({
      createdAt: -1,
    });

    const formattedAddresses = addresses.map((address) => {
      const parts = [
        address.houseNo,
        address.street1,
        address.street2,
        address.city,
        address.postalCode,
      ].filter(Boolean);

      return {
        _id: address._id,
        name: address.name,
        houseNo: address.houseNo,
        street1: address.street1,
        street2: address.street2,
        city: address.city,
        postalCode: address.postalCode,
        formattedAddress: parts.join(", "),
      };
    });

    res.send({ success: true, data: formattedAddresses });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

module.exports = route;
