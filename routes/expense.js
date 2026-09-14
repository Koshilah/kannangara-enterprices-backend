const express = require("express");
const mongoose = require("mongoose");
const route = express.Router();
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");
const Expense = require("../models/expense");
const { EXPENSE_CATEGORIES } = require("../models/expense");

//read all expenses
route.get("/", [auth, admin], async (req, res) => {
  try {
    const expenses = await Expense.find().sort({ date: -1 });

    return res.send({
      success: true,
      data: expenses,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading expenses",
    });
  }
});

//Add
route.post("/", [auth, admin], async (req, res) => {
  const { amount, shortDescription, category = "other", date } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).send({
      success: false,
      message: "amount must be a non-negative number",
    });
  }

  if (typeof shortDescription !== "string" || !shortDescription.trim()) {
    return res.status(400).send({
      success: false,
      message: "shortDescription is required",
    });
  }

  if (!EXPENSE_CATEGORIES.includes(category)) {
    return res.status(400).send({
      success: false,
      message: "category is invalid",
    });
  }

  if (date !== undefined && Number.isNaN(Date.parse(date))) {
    return res.status(400).send({
      success: false,
      message: "date must be a valid date",
    });
  }

  try {
    const expense = await Expense.create({
      amount,
      shortDescription,
      category,
      date,
    });

    return res.status(201).send({
      success: true,
      message: "Expense added successfully",
      data: expense,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while adding expense",
    });
  }
});

//update
route.patch("/:expenseId", [auth, admin], async (req, res) => {
  const { expenseId } = req.params;
  const { amount, shortDescription, category = "other", date } = req.body;

  if (!mongoose.Types.ObjectId.isValid(expenseId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid expense document id",
    });
  }

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).send({
      success: false,
      message: "amount must be a non-negative number",
    });
  }

  if (typeof shortDescription !== "string" || !shortDescription.trim()) {
    return res.status(400).send({
      success: false,
      message: "shortDescription is required",
    });
  }

  if (!EXPENSE_CATEGORIES.includes(category)) {
    return res.status(400).send({
      success: false,
      message: "category is invalid",
    });
  }

  if (date !== undefined && Number.isNaN(Date.parse(date))) {
    return res.status(400).send({
      success: false,
      message: "date must be a valid date",
    });
  }

  try {
    const expense = await Expense.findByIdAndUpdate(
      expenseId,
      {
        amount,
        shortDescription: shortDescription.trim(),
        category,
        date,
      },
      { new: true, runValidators: true },
    );

    if (!expense) {
      return res.status(404).send({
        success: false,
        message: "Expense not found",
      });
    }

    return res.send({
      success: true,
      message: "Expense updated successfully",
      data: expense,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while updating expense",
    });
  }
});

// delete
route.delete("/:expenseId", [auth, admin], async (req, res) => {
  const { expenseId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(expenseId)) {
    return res.status(400).send({
      success: false,
      message: "Invalid expense document id",
    });
  }

  try {
    const expense = await Expense.findByIdAndDelete(expenseId);

    if (!expense) {
      return res.status(404).send({
        success: false,
        message: "Expense not found",
      });
    }

    return res.send({
      success: true,
      message: "Expense deleted successfully",
      data: expense,
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while deleting expense",
    });
  }
});

module.exports = route;
