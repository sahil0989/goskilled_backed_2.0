const express = require("express");
const {
    addNewCourse,
    getAllCourses,
    getCourseDetailsByID,
    updateCourseByID,
    deleteCourseById,
} = require("../../../controllers/admin-controller/courses-controller/course-controller");

const router = express.Router();

// Add a new course
router.post("/add", addNewCourse);

// Get list of all courses
router.get("/get", getAllCourses);

// Get details of a course by ID
router.get("/get/details/:id", getCourseDetailsByID);

// Update a course by ID
router.put("/update/:id", updateCourseByID);

// Delete a course by ID
router.delete("/delete/:id", deleteCourseById);

module.exports = router;
