const mongoose = require("mongoose");

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

const Expense = mongoose.model("Expense", ExpenseSchema);

module.exports = Expense;
