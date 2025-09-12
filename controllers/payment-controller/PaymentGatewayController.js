const Payment = require("../../models/Payment");
const User = require("../../models/User");
const crypto = require("crypto");
const { Cashfree, CFEnvironment } = require("cashfree-pg");

// Cashfree configuration
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID;
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;

const cashfree = new Cashfree(
    process.env.NODE_ENV === "production"
        ? CFEnvironment.PRODUCTION
        : CFEnvironment.SANDBOX,
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

        const orderId = `GS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // 🔒 Generate per-order secret (HMAC using your CASHFREE_SECRET_KEY)
        const orderSecret = crypto
            .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
            .update(orderId + userId)
            .digest("hex");

        const cfOrder = await cashfree.PGCreateOrder({
            order_id: orderId,
            order_amount: parseFloat(amount).toFixed(2),
            order_currency: currency || "INR",
            customer_details: {
                customer_id: `GS_${userId}`,
                customer_email: email,
                customer_phone: mobileNumber,
            },
            order_note: `${packageType} Purchase`,
            order_expiry_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            order_meta: {
                return_url: `${process.env.FRONTEND_URL}/payment/success?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL}/user/payment/webhook`,
            },
        });


        const formattedCourses = courses.map((course) => ({
            courseId: course.id,
            courseTitle: course.name,
        }));

        // Save to DB with secret
        const payment = new Payment({
            user: userId,
            courses: formattedCourses,
            packageType,
            orderId,
            amount: parseFloat(amount).toFixed(2),
            currency: currency || "INR",
            status: "pending",
            orderSecret, // ✅ Save secret
            responseData: cfOrder.data,
        });

        await payment.save();

        return res.status(200).json({
            success: true,
            message: "Order created",
            order: cfOrder.data,
        });
    } catch (error) {
        console.error("Create Order Error:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            message: "Order creation failed",
            error: error.response?.data || error.message,
        });
    }
};

// 2️⃣ Webhook (Cashfree -> your backend)
const handleWebhook = async (req, res) => {
    try {
        const signature = req.headers["x-webhook-signature"];
        const rawBody = req.body.toString("utf8"); // <-- keep raw

        const computedSignature = crypto
            .createHmac("sha256", process.env.CASHFREE_WEBHOOK_SECRET) // use webhook secret
            .update(rawBody)
            .digest("base64");

        if (signature !== computedSignature) {
            console.warn("⚠️ Invalid Cashfree webhook signature");
            return res.status(400).json({ success: false, message: "Invalid signature" });
        }

        const eventData = JSON.parse(rawBody); // safe to parse now
        const orderId = eventData.data?.order?.order_id;
        const txStatus = eventData.data?.payment?.payment_status;

        console.log("📩 Webhook received:", orderId, txStatus);

        if (!orderId || !txStatus) {
            return res.status(400).json({ message: "Invalid webhook payload" });
        }

        const payment = await Payment.findOne({ orderId });
        if (!payment) {
            console.warn(`⚠️ Payment not found for orderId: ${orderId}`);
            return res.status(404).json({ message: "Payment not found" });
        }

        // ✅ Idempotency: If already marked success, skip further updates
        if (payment.status === "success") {
            console.log(`ℹ️ Payment ${orderId} already processed. Skipping...`);
            return res.sendStatus(200);
        }

        // Update payment
        payment.status = txStatus.toLowerCase();
        payment.transactionId = eventData.data?.payment?.cf_payment_id || payment.transactionId;
        payment.paymentMethod = eventData.data?.payment?.payment_method?.payment_mode || payment.paymentMethod;
        payment.responseData = eventData;
        await payment.save();

        // ✅ Grant access on success
        if (["SUCCESS", "PAID"].includes(txStatus)) {
            const user = await User.findById(payment.user);
            if (user) {
                const purchasedCourseIds = payment.courses.map(c => c.courseId);

                // Avoid duplicate push
                user.purchasedCourses.push(
                    ...purchasedCourseIds.filter(id => !user.purchasedCourses.includes(id))
                );
                user.enrolledCourses.push(
                    ...purchasedCourseIds.filter(id => !user.enrolledCourses.includes(id))
                );

                if (payment.packageType === "Skill Builder") {
                    user.purchasedPackages.skillBuilder = true;
                    user.purchasedPackages.careerBooster = false;
                } else if (payment.packageType === "Career Booster") {
                    user.purchasedPackages.careerBooster = true;
                    user.purchasedPackages.skillBuilder = false;
                }

                await user.save();
                console.log(`✅ User ${user._id} updated with purchased courses`);
            }
        }

        // Always return 200 so Cashfree doesn’t retry
        return res.sendStatus(200);

    } catch (error) {
        console.error("❌ Webhook Error:", error);
        // Still respond 200 to avoid Cashfree retry storm
        return res.sendStatus(200);
    }
};

// 3️⃣ Manual Verify (optional)
const verifyPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ message: "Order ID is required" });

        const orderResponse = await cashfree.PGFetchOrder(orderId);
        const paymentsResponse = await cashfree.PGOrderFetchPayments(orderId);

        if (!paymentsResponse.data || paymentsResponse.data.length === 0) {
            return res.status(400).json({ message: "No payment found for this order" });
        }

        const latestPayment = paymentsResponse.data[paymentsResponse.data.length - 1];
        const txStatus = latestPayment.payment_status;
        const transactionId = latestPayment.cf_payment_id;

        const payment = await Payment.findOne({ orderId });
        if (!payment) return res.status(404).json({ message: "Payment not found" });

        payment.status = txStatus.toLowerCase();
        payment.transactionId = transactionId;
        payment.paymentMethod = latestPayment.payment_method?.payment_mode || "UNKNOWN";
        payment.responseData = { orderResponse: orderResponse.data, paymentsResponse: paymentsResponse.data };
        await payment.save();

        return res.status(200).json({
            success: true,
            message: "Payment verified",
            status: txStatus,
            transactionId,
            payment
        });
    } catch (error) {
        console.error("Verify Payment Error:", error);
        return res.status(500).json({
            success: false,
            message: "Payment verification failed",
            error: error.message
        });
    }
};

// 4️⃣ User Payment History
const getUserPayments = async (req, res) => {
    try {
        const { userId } = req.params;
        const payments = await Payment.find({ user: userId })
            .populate("courses.courseId", "title category plan")
            .sort({ createdAt: -1 });

        return res.status(200).json({ success: true, payments });
    } catch (error) {
        console.error("Get Payment History Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch payments",
            error: error.message
        });
    }
};

module.exports = {
    createOrder,
    handleWebhook,
    verifyPayment,
    getUserPayments
};
