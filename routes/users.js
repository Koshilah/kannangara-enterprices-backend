const express = require("express");
const route = express.Router();
const _ = require("lodash");
const bcrypt = require("bcrypt");
const Joi = require("joi");
const { User, inputValidation } = require("../models/user");
const { signAccessToken } = require("../utils/tokens");
const auth = require("../middleware/auth");
const mannager = require("../middleware/manager");

const employeeFields = [
  "_id",
  "name",
  "email",
  "phone",
  "isAdmin",
  "isMannager",
  "isCashier",
];

const roleFlags = {
  cashier: { isAdmin: false, isMannager: false, isCashier: true },
  admin: { isAdmin: true, isMannager: false, isCashier: true },
  manager: { isAdmin: true, isMannager: true, isCashier: true },
};

const passwordSchema = Joi.string()
  .pattern(new RegExp(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/))
  .required();

function getEmployee(user) {
  return _.pick(user, employeeFields);
}

function getRoleFlags(role) {
  return roleFlags[role];
}

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
      _.pick(req.body, [
        "name",
        "email",
        "phone",
        "password",
        "isAdmin",
        "isMannager",
      ]),
    );

    const salt = await bcrypt.genSaltSync(10);
    const hash = await bcrypt.hashSync(newUser.password, salt);

    newUser.password = hash;

    await newUser.save();
    const token = signAccessToken(newUser);

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

route.get("/employees", [auth, mannager], async (req, res) => {
  try {
    const employees = await User.find({
      $or: [{ isAdmin: true }, { isMannager: true }, { isCashier: true }],
    })
      .select(employeeFields.join(" "))
      .sort({ name: 1 });

    res.send({ success: true, data: employees });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to load employees." });
  }
});

route.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id || req.user.id).select(
      "name email phone",
    );
    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found." });
    res.send({
      success: true,
      data: {
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
      },
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to load profile." });
  }
});

route.patch("/profile", auth, async (req, res) => {
  const name = req.body.name || req.body.fullName;
  const { email, phone } = req.body;
  const emailError = Joi.string().email().min(6).max(50).validate(email).error;

  if (!name || name.trim().length < 2 || name.trim().length > 40)
    return res.status(400).send({
      success: false,
      message: "Name must be between 2 and 40 characters.",
    });
  if (!email || emailError)
    return res
      .status(400)
      .send({ success: false, message: "Provide a valid email address." });

  if (phone !== undefined && phone !== null && phone.trim().length > 25) {
    return res
      .status(400)
      .send({
        success: false,
        message: "Phone number cannot exceed 25 characters.",
      });
  }

  try {
    const userID = req.user._id || req.user.id;
    const existingUser = await User.findOne({ email, _id: { $ne: userID } });
    if (existingUser)
      return res
        .status(400)
        .send({ success: false, message: "Email is already in use." });

    const updateFields = {
      name: name.trim(),
      email: email.trim(),
    };
    if (phone !== undefined && phone !== null) {
      updateFields.phone = phone.trim();
    }

    const user = await User.findByIdAndUpdate(
      userID,
      { $set: updateFields },
      { new: true, runValidators: true },
    ).select("name email phone");
    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found." });
    res.send({
      success: true,
      data: {
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
      },
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to update profile." });
  }
});

route.patch("/profile/password", auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const passwordError = passwordSchema.validate(newPassword).error;
  if (!currentPassword || passwordError)
    return res.status(400).send({
      success: false,
      message:
        "Use a valid password with at least 8 characters, including uppercase, lowercase, number, and symbol.",
    });

  try {
    const user = await User.findById(req.user._id || req.user.id);
    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found." });
    if (!(await bcrypt.compare(currentPassword, user.password)))
      return res
        .status(401)
        .send({ success: false, message: "Current password is incorrect." });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.send({ success: true, message: "Password updated successfully." });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to update password." });
  }
});

route.post("/employees", [auth, mannager], async (req, res) => {
  const error = inputValidation(
    _.pick(req.body, ["name", "email", "phone", "password"]),
  );
  if (error)
    return res
      .status(400)
      .send({ success: false, message: error.details[0].message });

  const flags = getRoleFlags(req.body.role);
  if (!flags)
    return res
      .status(400)
      .send({ success: false, message: "Choose a valid employee role." });

  try {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser)
      return res
        .status(400)
        .send({ success: false, message: "User already registered!." });

    const newUser = new User({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone || "",
      password: await bcrypt.hash(req.body.password, 10),
      ...flags,
    });

    await newUser.save();
    res.status(201).send({ success: true, data: getEmployee(newUser) });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to create employee." });
  }
});

route.patch("/employees/:id/role", [auth, mannager], async (req, res) => {
  const flags = getRoleFlags(req.body.role);
  if (!flags)
    return res
      .status(400)
      .send({ success: false, message: "Choose a valid employee role." });

  if (req.params.id === req.user.id && !flags.isMannager)
    return res.status(400).send({
      success: false,
      message: "You cannot remove your own manager access.",
    });

  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: flags },
      { new: true, runValidators: true },
    );

    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "Employee not found." });

    res.send({ success: true, data: getEmployee(user) });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to update employee role." });
  }
});

route.patch("/employees/:id/demote", [auth, mannager], async (req, res) => {
  if (req.params.id === req.user.id)
    return res
      .status(400)
      .send({ success: false, message: "You cannot demote your own account." });

  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { isAdmin: false, isMannager: false, isCashier: false } },
      { new: true },
    );

    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "Employee not found." });

    res.send({
      success: true,
      data: getEmployee(user),
      message: "Employee changed to a normal user.",
    });
  } catch (error) {
    res
      .status(500)
      .send({ success: false, message: "Unable to remove employee access." });
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
