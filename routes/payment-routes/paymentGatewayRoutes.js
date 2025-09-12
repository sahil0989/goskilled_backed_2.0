const express = require("express");
const router = express.Router();
const { createOrder, verifyPayment, getUserPayments, handleWebhook } = require("../../controllers/payment-controller/PaymentGatewayController");

// Create order
router.post("/submit", createOrder);

// Verify payment (Cashfree notify URL)
router.post("/verify", verifyPayment);

// 2️⃣ Cashfree Webhook (Cashfree calls this endpoint automatically)
router.post("/webhook", handleWebhook);

// Get user payment history
router.get("/history/:userId", getUserPayments);

module.exports = router;
