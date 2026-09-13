const express = require("express");
const auth = require("../middleware/auth");
const management = require("../middleware/management");
const Expense = require("../models/expense");
const Order = require("../models/order");

const route = express.Router();
const MONTHS_IN_REPORT = 12;
const TIME_ZONE = "Asia/Colombo";

function monthKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

function getReportMonths(monthCount) {
  const current = new Date();
  const months = [];

  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - offset, 1),
    );
    const key = monthKey(date);
    months.push({
      month: key,
      label: new Intl.DateTimeFormat("en-LK", {
        timeZone: TIME_ZONE,
        month: "short",
        year: "numeric",
      }).format(date),
      revenue: 0,
      expenses: 0,
      netProfit: 0,
    });
  }

  return months;
}

route.get("/summary", [auth, management], async (req, res) => {
  const requestedMonths = Number(req.query.months || MONTHS_IN_REPORT);
  const monthCount = Number.isInteger(requestedMonths)
    ? Math.min(Math.max(requestedMonths, 1), 24)
    : 0;

  if (!monthCount) {
    return res.status(400).send({
      success: false,
      message: "months must be an integer between 1 and 24",
    });
  }

  const months = getReportMonths(monthCount);
  const firstMonth = new Date(`${months[0].month}-01T00:00:00.000Z`);
  const monthMap = new Map(months.map((month) => [month.month, month]));

  try {
    const [revenueRows, expenseRows, categoryRows] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            dateOrdered: { $gte: firstMonth },
            orderStatus: { $ne: "cancelled" },
            paymentStatus: "paid",
            paymentStatus: { $in: ["paid", "successful"] },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m",
                date: "$dateOrdered",
                timezone: TIME_ZONE,
              },
            },
            total: { $sum: "$orderTotal" },
          },
        },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: firstMonth } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m",
                date: "$date",
                timezone: TIME_ZONE,
              },
            },
            total: { $sum: "$amount" },
          },
        },
      ]),
      Expense.aggregate([
        { $match: { date: { $gte: firstMonth } } },
        {
          $group: {
            _id: { $ifNull: ["$category", "other"] },
            total: { $sum: "$amount" },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    revenueRows.forEach((row) => {
      const month = monthMap.get(row._id);
      if (month) month.revenue = row.total;
    });

    expenseRows.forEach((row) => {
      const month = monthMap.get(row._id);
      if (month) month.expenses = row.total;
    });

    months.forEach((month) => {
      month.netProfit = month.revenue - month.expenses;
    });

    const currentMonth = months[months.length - 1];
    const totalRevenue = months.reduce(
      (total, month) => total + month.revenue,
      0,
    );
    const totalExpenses = months.reduce(
      (total, month) => total + month.expenses,
      0,
    );

    return res.send({
      success: true,
      data: {
        period: {
          months: monthCount,
          from: months[0].month,
          to: currentMonth.month,
        },
        currentMonth,
        totals: {
          revenue: totalRevenue,
          expenses: totalExpenses,
          netProfit: totalRevenue - totalExpenses,
        },
        monthly: months,
        expensesByCategory: categoryRows.map((row) => ({
          category: row._id,
          total: row.total,
        })),
      },
    });
  } catch (error) {
    return res.status(500).send({
      success: false,
      message: "Error occurred while loading financial summary",
    });
  }
});

module.exports = route;
