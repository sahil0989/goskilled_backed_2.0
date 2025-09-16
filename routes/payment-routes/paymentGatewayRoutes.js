const express = require("express");
const router = express.Router();

// Import controller
const {
  createOrder,
  handleWebhook,
  verifyPayment,
  getUserPayments
} = require("../../controllers/payment-controller/PaymentGatewayController");

// Route: Create order (user facing)
router.post("/submit", createOrder);

// Route: Manual verify (user/admin can call to check payment status)
router.post("/verify", verifyPayment);

// Webhook route (Cashfree calls this automatically)
router.post("/webhook", handleWebhook);

// Route: Get user payment history
router.get("/history/:userId", getUserPayments);

module.exports = router;
