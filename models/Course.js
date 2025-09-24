const mongoose = require("mongoose");

const ReviewSchema = new mongoose.Schema({
    rating: { type: Number, default: 5 },
    comment: String,
    reviewer: String,
});

const FAQSchema = new mongoose.Schema({
    question: String,
    answer: String,
});

const CurriculumModuleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    videoUrl: { type: String, required: true },
    freePreview: { type: Boolean, default: false },
});

const StudentSchema = new mongoose.Schema({
    studentId: String,
    studentName: String,
    studentEmail: String,
    paidAmount: String,
});

const CourseSchema = new mongoose.Schema({
    instructorName: { type: String, required: true },
    date: { type: Date, default: Date.now },

    title: { type: String, required: true },
    subtitle: String,
    description: String,

    image: String,
    imagePublicId: String,

    welcomeMessage: String,

    pricing: {
        standard: { type: Number, default: 0 },
        premium: { type: Number, default: 0 },
    },

    objectives: String,
    students: [StudentSchema],
    heroSection: { features: [String], content: [String] },
    whyChoose: [String],
    whatYouWillLearn: [String],
    whoIsThisFor: [String],
    reviews: [ReviewSchema],
    faqs: [FAQSchema],
    curriculum: [CurriculumModuleSchema],
    previewLessonUrl: String,
    tagline: String,
    category: String,
    plan: String,

    status: {
        type: String,
        enum: ["draft", "live"],
        default: "draft",
    },
});

module.exports = mongoose.model("Course", CourseSchema);
