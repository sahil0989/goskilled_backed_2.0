const mongoose = require("mongoose");
const PAYMENT_STATUS = require("../constants/paymentStatus")

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
      courseType: String
    }
  ],
  packageType: {
    type: String,
    enum: ["Skill Builder", "Career Booster"],
    required: true
  },
  orderId: { type: String, required: true, unique: true },
  transactionId: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },

  paymentMethod: {
    type: Object,
    default: {}
  },

  status: {
    type: String,
    enum: Object.values(PAYMENT_STATUS),
    default: PAYMENT_STATUS.PENDING,
  },
  responseData: { type: Object },
}, {
  timestamps: true
});


module.exports = mongoose.model("Payment", PaymentSchema);
