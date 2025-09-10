const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  courses: [
    {
      courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
      courseTitle: String,
    }
  ],
  packageType: {
    type: String,
    enum: ["Skill Builder", "Career Booster"],
    required: true
  },
  orderId: { type: String, required: true }, // Cashfree orderId
  transactionId: { type: String }, // Payment gateway transactionId
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  paymentMethod: { type: String }, // UPI, NetBanking, Card etc.
  status: {
    type: String,
    enum: ["pending", "success", "failed", "refunded"],
    default: "pending"
  },
  responseData: { type: Object }, // Raw Cashfree response (optional)
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update updatedAt automatically
PaymentSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("Payment", PaymentSchema);
