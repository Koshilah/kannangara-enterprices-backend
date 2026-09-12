const mongoose = require("mongoose");

const EXPENSE_CATEGORIES = [
  "inventory",
  "salaries",
  "utilities",
  "marketing",
  "rent",
  "transport",
  "other",
];

const ExpenseSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    shortDescription: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      default: "other",
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

ExpenseSchema.index({ date: 1, category: 1 });

const Expense = mongoose.model("Expense", ExpenseSchema);

module.exports = Expense;
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
