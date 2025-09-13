const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const morgan = require("morgan");

// Routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const walletRoutes = require("./routes/walletroutes/walletRoutes");
const kycRouter = require("./routes/kyc-routes/kyc-routes");
const adminCouses = require("./routes/admin-routes/course-routes/course-routes");
const mediaRoutes = require("./routes/instructor-routes/media-routes");
const adminRoutes = require("./routes/admin-routes/admin-routes");
const studentViewCourseRoutes = require("./routes/course-routes/courseRoutes");
const studentCourseProgress = require("./routes/course-routes/courseProgress");
const paymentRoutes = require("./routes/payment-routes/paymentRoutes");
const blogsRoutes = require("./routes/admin-routes/blogs-routes/blogs-routes");
const meetingRoutes = require("./routes/admin-routes/meeting-routes/meeting-roues");
const paymentGateway = require("./routes/payment-routes/paymentGatewayRoutes");

dotenv.config();

// ✅ MongoDB connection
require("./config/db");

const app = express();

// ✅ Security & Logging
app.use(helmet());
app.use(morgan("combined"));

// ✅ CORS: Restrict in production
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_URL // only allow your frontend
        : "*",
    credentials: true,
  })
);

// Body parser & capturing raw body for webhook verification
app.use(express.json({
  limit: "5mb",
  verify: (req, res, buf, encoding) => {
    // If this is Cashfree webhook route, save rawBody buffer
    if (req.originalUrl === "/user/payment/webhook") {
      req.rawBody = buf;
    }
  }
}))

// Health check
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", message: "Live URL" });
});

// Routes
app.use("/api/kyc", kycRouter);
app.use("/admin", adminRoutes);
app.use("/media", mediaRoutes);
app.use("/api/auth", authRoutes);
app.use("/admin/meetings", meetingRoutes);
app.use("/blogs", blogsRoutes);
app.use("/api/user", userRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/user/payment", paymentGateway);
app.use("/admin/courses", adminCouses);
app.use("/student/course", studentViewCourseRoutes);
app.use("/student/course-progress", studentCourseProgress);

// ✅ Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).json({
    success: false,
    message: "Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV} on port ${PORT}`);
});
