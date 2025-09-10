const Payment = require("../../models/Payment");
const User = require("../../models/User");
const Course = require("../../models/Course");
const { Cashfree, CFEnvironment } = require("cashfree-pg");

// Cashfree configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;

// Initialize Cashfree SDK
const cashfree = new Cashfree(
    process.env.NODE_ENV === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
    CASHFREE_APP_ID,
    CASHFREE_SECRET_KEY
);

// 1️⃣ Create Order
const createOrder = async (req, res) => {
    try {
        const { userId, courses, packageType, amount, currency, email, mobileNumber } = req.body;

        if (!userId || !courses || !amount || !email || !mobileNumber) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        // Generate unique orderId
        const orderId = `GS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // ✅ Fix customer_details
        const cfOrder = await cashfree.PGCreateOrder({
            order_id: orderId,
            order_amount: parseFloat(amount).toFixed(2),
            order_currency: currency || "INR",
            customer_details: {
                customer_id: `GS_${userId}`,
                customer_email: email,
                customer_phone: mobileNumber
            },
            order_note: `${packageType} Purchase`,
            order_expiry_time: new Date(Date.now() + 0.5 * 60 * 60 * 1000).toISOString(),
            order_meta: {
                return_url: `${process.env.FRONTEND_URL}/payment/success?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL}/api/payment/verify`
            },
        });

        // Save to DB
        const payment = new Payment({
            user: userId,
            courses,
            packageType,
            orderId,
            amount: parseFloat(amount).toFixed(2),
            currency: currency || "INR",
            status: "pending",
            responseData: cfOrder.data
        });

        // await payment.save();

        return res.status(200).json({
            success: true,
            message: "Order created",
            order: cfOrder.data
        });
    } catch (error) {
        console.error("Create Order Error:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Order creation failed",
            error: error.response?.data || error.message
        });
    }
};


// 2️⃣ Verify Payment (Webhook or callback)
const verifyPayment = async (req, res) => {
    try {
        const data = req.body; // Cashfree webhook payload
        const orderId = data?.data?.order?.order_id || req.body.orderId;
        const txStatus = data?.data?.payment?.payment_status || req.body.txStatus;
        const transactionId = data?.data?.payment?.cf_payment_id || req.body.transactionId;
        const paymentMode = data?.data?.payment?.payment_method?.payment_mode || req.body.paymentMode;

        const payment = await Payment.findOne({ orderId });
        if (!payment) {
            return res.status(404).json({ message: "Payment not found" });
        }

        payment.status = txStatus?.toLowerCase();
        payment.transactionId = transactionId;
        payment.paymentMethod = paymentMode;
        payment.responseData = data;
        await payment.save();

        if (txStatus === "SUCCESS" || txStatus === "PAID") {
            const user = await User.findById(payment.user);
            if (user) {
                const purchasedCourseIds = payment.courses.map(c => c.courseId);
                user.purchasedCourses.push(...purchasedCourseIds);
                user.enrolledCourses.push(...purchasedCourseIds);

                if (payment.packageType === "Skill Builder") {
                    user.purchasedPackages.skillBuilder = true;
                    user.purchasedPackages.careerBooster = false;
                } else if (payment.packageType === "Career Booster") {
                    user.purchasedPackages.careerBooster = true;
                    user.purchasedPackages.skillBuilder = false;
                }

                await user.save();
            }
        }

        return res.status(200).json({ success: true, message: "Payment verified", payment });
    } catch (error) {
        console.error("Verify Payment Error:", error);
        return res.status(500).json({ success: false, message: "Payment verification failed", error: error.message });
    }
};

// 3️⃣ Get User Payment History
const getUserPayments = async (req, res) => {
    try {
        const { userId } = req.params;
        const payments = await Payment.find({ user: userId })
            .populate("courses.courseId", "title category plan")
            .sort({ createdAt: -1 });

        return res.status(200).json({ success: true, payments });
    } catch (error) {
        console.error("Get Payment History Error:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch payments", error: error.message });
    }
};

module.exports = {
    createOrder,
    verifyPayment,
    getUserPayments
};
