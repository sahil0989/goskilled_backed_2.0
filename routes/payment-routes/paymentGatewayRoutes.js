const express = require("express");
const router = express.Router();
const { createOrder, verifyPayment, getUserPayments } = require("../../controllers/payment-controller/PaymentGatewayController");

// Create order
router.post("/submit", createOrder);

// Verify payment (Cashfree notify URL)
router.post("/verify", verifyPayment);

// Get user payment history
router.get("/history/:userId", getUserPayments);

module.exports = router;
