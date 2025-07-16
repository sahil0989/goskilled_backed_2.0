const Course = require("../../../models/Course");
const User = require("../../../models/User");

// Add a New Course
const addNewCourse = async (req, res) => {
    try {
        let courseData = req.body;

        if (!courseData || Object.keys(courseData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Course data is required",
            });
        }

        if (typeof courseData.pricing === "string") {
            courseData.pricing = {
                standard: Number(courseData.pricing.standard),
                premium: 0,
                discountNote: "",
                gstNote: "",
                bonuses: [],
            };
        }

        if (Array.isArray(courseData.reviews)) {
            courseData.reviews = courseData.reviews.map((rev) => ({
                rating: Number(rev.rating) || 5,
                comment: rev.comment,
                reviewer: rev.reviewer
            }));
        }

        // 🛠 Strip extra fields not in schema
        const allowedFields = [
            "instructorName", "date", "title", "subtitle", "description",
            "image", "imagePublicId", "welcomeMessage", "pricing", "objectives",
            "students", "heroSection", "whyChoose", "whatYouWillLearn", "whoIsThisFor",
            "reviews", "faqs", "lectures", "isPublished", "curriculum", "previewLessonUrl"
        ];
        courseData = Object.fromEntries(
            Object.entries(courseData).filter(([key]) => allowedFields.includes(key))
        );

        const newCourse = new Course(courseData);
        const savedCourse = await newCourse.save();

        return res.status(201).json({
            success: true,
            message: "Course saved successfully",
            data: savedCourse,
        });
    } catch (error) {
        console.error("Add New Course Error:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while saving the course.",
        });
    }
};

// Get All Courses
const getAllCourses = async (req, res) => {
    try {
        const coursesList = await Course.find({});
        return res.status(200).json({
            success: true,
            data: coursesList,
        });
    } catch (error) {
        console.error("Get All Courses Error:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching the courses.",
        });
    }
};

// Get Course by ID
const getCourseDetailsByID = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Course ID is required",
            });
        }

        const course = await Course.findById(id);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: "Course not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: course,
        });
    } catch (error) {
        console.error("Get Course Details Error:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching the course details.",
        });
    }
};

// Update Course by ID
const updateCourseByID = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedData = req.body;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Course ID is required",
            });
        }

        if (!updatedData || Object.keys(updatedData).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Updated course data is required",
            });
        }

        const updatedCourse = await Course.findByIdAndUpdate(id, updatedData, {
            new: true,
        });

        if (!updatedCourse) {
            return res.status(404).json({
                success: false,
                message: "Course not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Course updated successfully",
            data: updatedCourse,
        });
    } catch (error) {
        console.error("Update Course Error:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while updating the course.",
        });
    }
};

// Delete Course by ID
const deleteCourseById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Course ID is required",
            });
        }

        const deletedCourse = await Course.findByIdAndDelete(id);

        if (!deletedCourse) {
            return res.status(404).json({
                success: false,
                message: "Course not found",
            });
        }

        // Remove course reference from users
        await User.updateMany(
            {
                $or: [
                    { purchasedCourses: id },
                    { enrolledCourses: id },
                ],
            },
            {
                $pull: {
                    purchasedCourses: id,
                    enrolledCourses: id,
                },
            }
        );

        return res.status(200).json({
            success: true,
            message: "Course deleted and removed from users’ records.",
        });
    } catch (error) {
        console.error("Delete Course Error:", error);
        res.status(500).json({
            success: false,
            message: "An error occurred while deleting the course.",
        });
    }
};

module.exports = {
    addNewCourse,
    getAllCourses,
    getCourseDetailsByID,
    updateCourseByID,
    deleteCourseById,
};
