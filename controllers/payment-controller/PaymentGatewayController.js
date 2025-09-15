const Payment = require("../../models/Payment");
const User = require("../../models/User");
const crypto = require("crypto");
const { Cashfree, CFEnvironment } = require("cashfree-pg");

// Constants / Enums
const PAYMENT_STATUS = require("../../constants/paymentStatus")

// Setup Cashfree
const cashfree = new Cashfree(
    process.env.NODE_ENV === "production"
        ? CFEnvironment.PRODUCTION
        : CFEnvironment.SANDBOX,
    process.env.CASHFREE_APP_ID,
    process.env.CASHFREE_SECRET_KEY
);

// Helper: generate orderSecret (if you still need it)
function generateOrderSecret(orderId, userId) {
    return crypto
        .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
        .update(orderId + userId)
        .digest("hex");
}

// 1️⃣ Create Order
const createOrder = async (req, res) => {
    try {
        const { userId, courses, packageType, amount, currency, email, mobileNumber } = req.body;

        if (!userId || !courses || !amount || !email || !mobileNumber) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const orderId = `GS_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const orderSecret = generateOrderSecret(orderId, userId);

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

        const coursesArray = Array.isArray(courses) ? courses : [courses];
        const formattedCourses = coursesArray.map((course) => ({
            courseId: course.id,
            courseTitle: course.name,
            courseType: course.courseType,
        }));

        const paymentRecord = new Payment({
            user: userId,
            courses: formattedCourses,
            packageType,
            orderId,
            amount: parseFloat(amount).toFixed(2),
            currency: currency || "INR",
            status: PAYMENT_STATUS.PENDING,
            orderSecret,
            responseData: cfOrder.data,
        });

        await paymentRecord.save();

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

const handleWebhook = async (req, res) => {
    try {
        const signature = req.headers["x-webhook-signature"];
        const timestamp = req.headers["x-webhook-timestamp"];
        const rawBodyBuffer = req.rawBody;
        const secret = process.env.CASHFREE_WEBHOOK_SECRET;

        if (!signature || !timestamp) {
            console.warn("Missing signature or timestamp headers");
            return res.status(400).json({ success: false, message: "Missing headers" });
        }

        // Build expected signature
        const payloadString = rawBodyBuffer.toString("utf8");
        const signedPayload = timestamp + payloadString;
        const expectedSignature = crypto
            .createHmac("sha256", secret)
            .update(signedPayload)
            .digest("base64");

        if (expectedSignature !== signature) {
            console.warn("⚠️ Invalid Cashfree webhook signature");
            return res.status(400).json({ success: false, message: "Invalid signature" });
        }

        const eventData = JSON.parse(payloadString);
        const orderId = eventData.data?.order?.order_id;
        const txStatus = eventData.data?.payment?.payment_status;

        if (!orderId || !txStatus) {
            console.warn("Invalid webhook payload: missing fields");
            return res.status(400).json({ success: false, message: "Missing orderId or status" });
        }

        const paymentRecord = await Payment.findOne({ orderId });
        if (!paymentRecord) {
            console.warn(`Payment not found for orderId: ${orderId}`);
            return res.status(404).json({ success: false, message: "Payment record not found" });
        }

        console.log("💳 Payment Method: ", paymentRecord.responseData);

        // Idempotency: skip if already success
        if (paymentRecord.status === PAYMENT_STATUS.SUCCESS) {
            console.log(`ℹ️ Payment ${orderId} already processed. Skipping...`);
            return res.sendStatus(200);
        }

        // Update payment record
        paymentRecord.status = txStatus.toLowerCase();
        paymentRecord.transactionId =
            eventData.data?.payment?.cf_payment_id || paymentRecord.transactionId;
        paymentRecord.paymentMethod =
            eventData.data?.payment?.payment_method?.payment_mode ||
            paymentRecord.paymentMethod;
        paymentRecord.responseData = eventData;
        await paymentRecord.save();

        // ✅ Grant access on success (atomic update, no VersionError)
        if (["SUCCESS", "PAID"].includes(txStatus.toUpperCase())) {
            const purchasedCourseIds = paymentRecord.courses.map((c) =>
                c.courseId.toString()
            );

            const updateOps = {
                $addToSet: {
                    purchasedCourses: { $each: purchasedCourseIds },
                    enrolledCourses: { $each: purchasedCourseIds },
                },
            };

            // Handle package flags
            if (paymentRecord.packageType === "Skill Builder") {
                updateOps.$set = {
                    purchasedPackages: { skillBuilder: true, careerBooster: false },
                };
            } else if (paymentRecord.packageType === "Career Booster") {
                updateOps.$set = {
                    purchasedPackages: { careerBooster: true, skillBuilder: false },
                };
            }

            await User.findByIdAndUpdate(paymentRecord.user, updateOps);

            console.log(
                `✅ User ${paymentRecord.user} updated with unique purchased courses`
            );
        }

        return res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook Error:", error);
        // Return 500 so Cashfree retries if something fails internally
        return res.sendStatus(500);
    }
};

const verifyPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ success: false, message: "orderId is required" });

        const paymentsResponse = await cashfree.PGOrderFetchPayments(orderId);
        const orderResponse = await cashfree.PGFetchOrder(orderId);

        if (!paymentsResponse.data || paymentsResponse.data.length === 0) {
            return res.status(400).json({ success: false, message: "No payments found for this order" });
        }

        const latestPayment = paymentsResponse.data[paymentsResponse.data.length - 1];
        const txStatus = latestPayment.payment_status;
        const transactionId = latestPayment.cf_payment_id;
        const paymentMethod = latestPayment.payment_method?.payment_mode || "UNKNOWN";

        const paymentRecord = await Payment.findOne({ orderId });
        if (!paymentRecord) return res.status(404).json({ success: false, message: "Payment record not found" });

        // Optional: verify amount matches as before
        if (parseFloat(orderResponse.data.order_amount) !== parseFloat(paymentRecord.amount)) {
            console.warn(`⚠️ Amount mismatch during manual verify for order ${orderId}`);
        }

        paymentRecord.status = txStatus.toLowerCase();
        paymentRecord.transactionId = transactionId;
        paymentRecord.paymentMethod = paymentMethod;
        paymentRecord.responseData = {
            order: orderResponse.data,
            payments: paymentsResponse.data
        };
        await paymentRecord.save();

        return res.status(200).json({
            success: true,
            message: "Payment verified",
            status: txStatus,
            transactionId,
            payment: paymentRecord
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

const getUserPayments = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ success: false, message: "userId is required" });
        }
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
