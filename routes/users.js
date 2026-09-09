const express = require("express");
const route = express.Router();
const _ = require("lodash");
const bcrypt = require("bcrypt");
const { User, inputValidation } = require("../models/user");
const auth = require("../middleware/auth");
const mannager = require("../middleware/manager");

route.post("/", async (req, res) => {
  const error = inputValidation(req.body);
  if (error)
    return res
      .status(400)
      .send({ success: false, message: error.details[0].message });

  let existingUser = await User.findOne({ email: req.body.email });
  if (existingUser)
    return res
      .status(400)
      .send({ success: false, message: "User already registered!." });

  try {
    const newUser = new User(
      _.pick(req.body, ["name", "email", "password", "isAdmin", "isMannager"]),
    );

    const salt = await bcrypt.genSaltSync(10);
    const hash = await bcrypt.hashSync(newUser.password, salt);

    newUser.password = hash;

    await newUser.save();
    const token = newUser.generateJWT();

    res
      .header("x-auth-token", token)
      .header("access-control-expose-headers", "x-auth-token")
      .send(token);
  } catch (error) {
    res.status(500).send("Error occured: " + error);
  }
});

route.post("/admin", [auth, mannager], async (req, res) => {
  const error = inputValidation(req.body);
  if (error)
    return res
      .status(400)
      .send({ success: false, message: error.details[0].message });

  let existingUser = await User.findOne({ email: req.body.email });
  if (existingUser)
    return res
      .status(400)
      .send({ success: false, message: "User already registered!." });

  try {
    const newUser = new User(_.pick(req.body, ["name", "email", "password"]));

    const salt = await bcrypt.genSaltSync(10);
    const hash = await bcrypt.hashSync(newUser.password, salt);

    newUser.password = hash;
    newUser.isAdmin = true;

    await newUser.save();

    res.send({ success: true, message: "Admin Created" });
  } catch (error) {
    res.status(500).send("Error occured: " + error);
  }
});

route.delete("/", auth, async (req, res) => {
  if (!req.body.password)
    return res
      .status(400)
      .send({ success: false, message: "Provide your password!" });

  try {
    const user = await User.findById(req.user.id);

    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found!" });

    const isPasswordMatch = await bcrypt.compare(
      req.body.password,
      user.password,
    );

    if (!isPasswordMatch)
      return res
        .status(401)
        .send({ success: false, message: "Incorrect password!" });

    await User.deleteOne({ _id: user._id });

    res.send({ success: true, message: "Account deleted successfully." });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Error occured: " + error });
  }
});

route.patch("/promote", [auth, mannager], async (req, res) => {
  if (!req.body.email)
    return res
      .status(400)
      .send({ success: false, message: "Provide a valid Email!" });

  try {
    const user = await User.findOneAndUpdate(
      { email: req.body.email },
      { $set: { isAdmin: true } },
      { new: true },
    );

    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found!" });

    res.send({
      success: true,
      message: "User promoted to admin successfully.",
      user: _.pick(user, ["name", "email", "isAdmin"]),
    });
  } catch (error) {
    res.status(500).send("Error occured: " + error);
  }
});

route.get("/", [auth, mannager], async (req, res) => {
  if (!req.body.email)
    return res
      .status(400)
      .send({ success: false, message: "Provide a valid Email!" });

  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found!" });

    res.send(_.pick(user, ["name", "email"]));
  } catch (error) {
    res.status(500).send("Error occured: " + error);
  }
});

module.exports = route;
