const Course = require("../../models/Course");
const User = require("../../models/User");

const getAllStudentViewCourses = async (req, res) => {
  try {
    // Extract query parameters as strings
    const { category = "", level = "", primaryLanguage = "", sortBy = "price-lowtohigh" } = req.query;

    // Convert comma-separated strings to arrays, or empty arrays if none
    const categories = category ? category.split(",") : [];
    const levels = level ? level.split(",") : [];
    const languages = primaryLanguage ? primaryLanguage.split(",") : [];

    // Build filters object conditionally
    const filters = { status: "live" }; // 🔹 Only live courses
    if (categories.length) filters.category = { $in: categories };
    if (levels.length) filters.level = { $in: levels };
    if (languages.length) filters.primaryLanguage = { $in: languages };

    // Define sorting parameters
    let sortParam = {};
    switch (sortBy.toLowerCase()) {
      case "price-lowtohigh":
        sortParam["pricing.standard"] = 1;
        break;
      case "price-hightolow":
        sortParam["pricing.standard"] = -1;
        break;
      case "title-atoz":
        sortParam.title = 1;
        break;
      case "title-ztoa":
        sortParam.title = -1;
        break;
      default:
        sortParam["pricing.standard"] = 1;
        break;
    }

    // Fetch courses with filters and sorting
    const coursesList = await Course.find(filters).sort(sortParam);

    return res.status(200).json({
      success: true,
      message: "Courses fetched successfully",
      data: coursesList,
    });
  } catch (error) {
    console.error("Error fetching courses:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching courses",
    });
  }
};

const getStudentViewCourseDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "Course ID is required" });
    }

    const courseDetails = await Course.findById(id);

    if (!courseDetails) {
      return res.status(404).json({
        success: false,
        message: "No course details found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Course details fetched successfully",
      data: courseDetails,
    });
  } catch (error) {
    console.error("Error fetching course details:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching course details",
    });
  }
};

const checkCoursePurchaseInfo = async (req, res) => {
  try {
    const { id: courseId, studentId } = req.params;

    if (!courseId || !studentId) {
      return res.status(400).json({
        success: false,
        message: "Course ID and Student ID are required",
      });
    }

    const student = await User.findById(studentId).select("purchasedCourses");

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    // Check enrollment in or purchasedCourses (if you want)
    const isEnrolled =
      (student.purchasedCourses || []).some((course) => course.toString() === courseId);

    return res.status(200).json({
      success: true,
      enrolled: isEnrolled,
      message: isEnrolled ? "Student is enrolled in the course" : "Student is not enrolled in the course",
    });
  } catch (error) {
    console.error("Error checking purchase info:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while checking purchase info",
    });
  }
};

const getAllUserDetails = async (req, res) => {
  try {
    const users = await User.find().select("name mobileNumber referralCode");

    // Use Promise.all to await countDocuments for each user
    const userData = await Promise.all(
      users.map(async (user) => {
        const totalReferrals = await User.countDocuments({ referredBy: user._id });
        return {
          _id: user._id,
          name: user.name,
          mobileNumber: user.mobileNumber,
          totalReferrals,
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: "User details fetched successfully",
      data: userData,
    });
  } catch (error) {
    console.error("Error fetching user details:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching user details",
    });
  }
};

const checkEnrolledCourse = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ enrolled: false, message: "User ID is required" });
    }

    const user = await User.findById(userId).select("purchasedCourses");

    if (!user) {
      return res.status(404).json({
        enrolled: false,
        message: "User not found",
      });
    }

    const isEnrolled = Array.isArray(user.purchasedCourses) && user.purchasedCourses.length > 0;

    return res.status(200).json({
      enrolled: isEnrolled,
      message: isEnrolled ? "User is enrolled in at least one course" : "User is not enrolled in any course",
    });
  } catch (error) {
    console.error("Error checking enrollment:", error);
    return res.status(500).json({
      enrolled: false,
      message: "Internal server error while checking enrollment",
    });
  }
};

const clearUserCourses = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { purchasedCourses: [] } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: "User courses cleared successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error clearing user courses:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while clearing user courses",
    });
  }
};

module.exports = {
  getAllStudentViewCourses,
  getStudentViewCourseDetails,
  checkCoursePurchaseInfo,
  getAllUserDetails,
  checkEnrolledCourse,
  clearUserCourses,
};
