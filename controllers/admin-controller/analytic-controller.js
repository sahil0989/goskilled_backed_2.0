const User = require('../../models/User');
const Payment = require('../../models/Payment');
const Meeting = require('../../models/meeting/Meeting');
const MeetingRegistration = require('../../models/meeting/MeetingRegistration');
const WithdrawalRequest = require('../../models/PaymentRequestSchema');
const Blog = require('../../models/Blogs');

exports.getDashboardMetrics = async (req, res) => {
  try {
    // ======== USERS ========
    const userStatus = await User.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const userPackages = await User.aggregate([
      { $group: { _id: "$packageType", count: { $sum: 1 } } }
    ]);

    const topReferrers = await User.aggregate([
      { 
        $project: { 
          name: 1, 
          level1Count: { $size: { $ifNull: ["$referralLevels.level1", []] } } 
        } 
      },
      { $sort: { level1Count: -1 } },
      { $limit: 10 }
    ]);

    // ✅ Fix KYC status counts (matching your schema enums)
    const rawKycStatus = await User.aggregate([
      { $group: { _id: "$kycStatus", count: { $sum: 1 } } }
    ]);

    const kycSummary = {
      not_submitted: 0,
      pending: 0,
      approved: 0,
      rejected: 0
    };

    rawKycStatus.forEach(item => {
      if (item._id === "not_submitted") kycSummary.not_submitted = item.count;
      else if (item._id === "pending") kycSummary.pending = item.count;
      else if (item._id === "approved") kycSummary.approved = item.count;
      else if (item._id === "rejected") kycSummary.rejected = item.count;
    });

    const walletStats = await User.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$wallet.balance" },
          totalEarned: { $sum: "$wallet.totalEarned" },
          totalWithdrawn: { $sum: "$wallet.totalWithdrawn" }
        }
      }
    ]);

    // ======== MEETINGS ========
    const registrationsPerMeeting = await MeetingRegistration.aggregate([
      { $group: { _id: "$meetingId", count: { $sum: 1 } } },
      {
        $lookup: {
          from: "meetings",
          localField: "_id",
          foreignField: "_id",
          as: "meeting"
        }
      },
      { $unwind: "$meeting" },
      { $project: { title: "$meeting.title", count: 1 } }
    ]);

    const registrationsOverTime = await MeetingRegistration.aggregate([
      { 
        $group: { 
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$registeredAt" } }, 
          count: { $sum: 1 } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);

    const meetingStatus = await Meeting.aggregate([
      {
        $group: {
          _id: "$isExpired",
          count: { $sum: 1 }
        }
      }
    ]);

    // ======== PAYMENTS ========
    const revenueOverTime = await Payment.aggregate([
      { $match: { status: "SUCCESS" } },
      { 
        $group: { 
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, 
          totalRevenue: { $sum: "$amount" } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);

    const revenueByPackage = await Payment.aggregate([
      { $match: { status: "SUCCESS" } },
      { 
        $group: { 
          _id: "$packageType", 
          totalRevenue: { $sum: "$amount" }, 
          count: { $sum: 1 } 
        } 
      }
    ]);

    const paymentMethods = await Payment.aggregate([
      { $match: { status: "SUCCESS" } },
      { 
        $group: { 
          _id: "$paymentMethod.type", 
          count: { $sum: 1 }, 
          totalAmount: { $sum: "$amount" } 
        } 
      }
    ]);

    const paymentStatus = await Payment.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    const topCoursesRevenue = await Payment.aggregate([
      { $match: { status: "SUCCESS" } },
      { $unwind: "$courses" },
      { 
        $group: { 
          _id: "$courses.courseTitle", 
          totalRevenue: { $sum: "$amount" } 
        } 
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ]);

    // ======== WITHDRAWALS ========
    const withdrawalsOverTime = await WithdrawalRequest.aggregate([
      { 
        $group: { 
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$requestedAt" } }, 
          totalAmount: { $sum: "$amount" }, 
          count: { $sum: 1 } 
        } 
      },
      { $sort: { _id: 1 } }
    ]);

    const withdrawalStatus = await WithdrawalRequest.aggregate([
      { 
        $group: { 
          _id: "$status", 
          count: { $sum: 1 }, 
          totalAmount: { $sum: "$amount" } 
        } 
      }
    ]);

    const topWithdrawals = await WithdrawalRequest.aggregate([
      { $match: { status: "Paid" } },
      { $group: { _id: "$userId", totalWithdrawn: { $sum: "$amount" } } },
      { $sort: { totalWithdrawn: -1 } },
      { $limit: 10 },
      { 
        $lookup: { 
          from: "users", 
          localField: "_id", 
          foreignField: "_id", 
          as: "user" 
        } 
      },
      { $unwind: "$user" },
      { $project: { userName: "$user.name", totalWithdrawn: 1 } }
    ]);

    const avgWithdrawal = await WithdrawalRequest.aggregate([
      { $group: { _id: null, avgAmount: { $avg: "$amount" }, totalWithdrawals: { $sum: 1 } } }
    ]);

    // ======== BLOGS ========
    const totalBlogs = await Blog.countDocuments();

    // ======== RESPONSE ========
    res.json({
      users: { 
        userStatus, 
        userPackages, 
        topReferrers, 
        kycSummary,  
        walletStats 
      },
      meetings: { registrationsPerMeeting, registrationsOverTime, meetingStatus },
      payments: { revenueOverTime, revenueByPackage, paymentMethods, paymentStatus, topCoursesRevenue },
      withdrawals: { withdrawalsOverTime, withdrawalStatus, topWithdrawals, avgWithdrawal },
      blogs: { totalBlogs }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
};
