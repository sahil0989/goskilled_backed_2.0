const Payment = require("../../models/Payment");
const Course = require("../../models/Course")
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

// Helper: for payment extraction such as upi, net_banking and card
function extractPaymentMethod(method) {
    if (!method) return { type: "UNKNOWN", details: null };

    if (method.card) {
        return {
            type: "CARD",
            network: method.card.card_network,
            bank: method.card.card_bank_name,
            number: method.card.card_number,
        };
    }

    if (method.netbanking) {
        return {
            type: "NETBANKING",
            bank: method.netbanking.netbanking_bank_name,
            code: method.netbanking.netbanking_bank_code,
        };
    }

    if (method.upi) {
        return {
            type: "UPI",
            vpa: method.upi.upi_id,
        };
    }

    return { type: "UNKNOWN", details: null };
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
                return_url: `${process.env.FRONTEND_URL}/payment/verify?order_id={order_id}`,
                notify_url: `${process.env.BACKEND_URL}/user/payment/webhook`,
                payment_methods: "cc,dc,upi,nb"
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

        // Idempotency: skip if already success
        if (paymentRecord.status === PAYMENT_STATUS.SUCCESS) {
            console.log(`ℹ️ Payment ${orderId} already processed. Skipping...`);
            return res.sendStatus(200);
        }

        // Update payment record
        paymentRecord.status = txStatus.toLowerCase();
        paymentRecord.transactionId =
            eventData.data?.payment?.cf_payment_id || paymentRecord.transactionId;
        paymentRecord.paymentMethod = extractPaymentMethod(
            eventData.data?.payment?.payment_method
        );
        paymentRecord.responseData = eventData;
        await paymentRecord.save();

        // ✅ Grant access on success (atomic update, no VersionError)
        if (["SUCCESS", "PAID"].includes(txStatus.toUpperCase())) {

            const courses = Array.isArray(paymentRecord.courses) ? paymentRecord.courses : [paymentRecord.courses];

            for (const course of courses) {
                const currentCourse = await Course.findById(course.courseId);
                if (!currentCourse) {
                    console.warn(`Course not found: ${course.courseId}`);
                    continue;
                }

                const alreadyAdded = currentCourse.students.some(
                    s => s.studentId.toString() === paymentRecord.user.toString()
                );


                if (!alreadyAdded) {
                    currentCourse.students.push({
                        studentId: paymentRecord?.user,
                        studentName: user?.name,
                        studentEmail: user?.email,
                        paidAmount: paymentRecord?.amount,
                    });
                }

                await currentCourse.save();
            }

            const purchasedCourseIds = paymentRecord.courses.map((c) =>
                c.courseId.toString()
            );

            const updateOps = {
                $addToSet: {
                    purchasedCourses: { $each: purchasedCourseIds },
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

            // const user = await User.findById(paymentRecord.user);

            // console.log("✨ Ouside the package...")

            // if (user.packageType === "No Course") {
            //     user.packageType = paymentRecord.packageType;
            //     await user.save();

            //     console.log("✨ Inside the packange......")

            //     const rewardConfig = {
            //         "Skill Builder": [900, 150, 75],
            //         "Career Booster": [1250, 250, 150],
            //     };

            //     const rewardArray = rewardConfig[paymentRecord.packageType];
            //     if (rewardArray) {
            //         let currentUser = user;

            //         for (let level = 1; level <= 3; level++) {
            //             if (!currentUser.referredBy) break;

            //             const referrer = await User.findById(currentUser.referredBy);
            //             if (!referrer) break;

            //             const levelKey = `level${level}`;
            //             if (!referrer.referralLevels) referrer.referralLevels = {};
            //             if (!referrer.referralLevels[levelKey]) referrer.referralLevels[levelKey] = [];

            //             if (!referrer.referralLevels[levelKey].includes(user._id)) {
            //                 referrer.referralLevels[levelKey].push(user._id);
            //             }

            //             const rewardAmount = rewardArray[level - 1];

            //             if (typeof rewardAmount === "number" && rewardAmount > 0) {
            //                 // ✅ use the same values your schema expects
            //                 const courseTypeEnum = paymentRecord.packageType; // "Skill Builder" or "Career Booster"

            //                 // ✅ Idempotency check
            //                 const alreadyRewarded = referrer.priceHistory?.some(
            //                     (h) =>
            //                         h.purchasedBy.toString() === user._id.toString() &&
            //                         h.level === level &&
            //                         h.courseType === courseTypeEnum &&
            //                         h.paymentId?.toString() === paymentRecord._id.toString()
            //                 );

            //                 if (!alreadyRewarded) {
            //                     referrer.wallet.balance += rewardAmount;
            //                     referrer.wallet.totalEarned += rewardAmount;

            //                     referrer.priceHistory = referrer.priceHistory || [];
            //                     referrer.priceHistory.push({
            //                         amount: rewardAmount,
            //                         courseType: courseTypeEnum, // ✅ now matches schema
            //                         purchasedDate: new Date(),
            //                         purchasedBy: user._id,
            //                         level: level,
            //                         paymentId: paymentRecord._id,
            //                     });
            //                 }
            //             }

            //             await referrer.save();

            //             currentUser = referrer;
            //         }
            //     }
            // }

            // console.log("✨ End of wallet........")


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

        const methodDetails = extractPaymentMethod(latestPayment.payment_method);

        paymentRecord.status = txStatus.toLowerCase();
        paymentRecord.transactionId = transactionId;
        paymentRecord.paymentMethod = methodDetails;
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
