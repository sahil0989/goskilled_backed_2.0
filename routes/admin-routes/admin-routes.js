const express = require("express");
const { getAllUserDetails } = require("../../controllers/admin-controller/admin-controller");
const { getDashboardMetrics } = require("../../controllers/admin-controller/analytic-controller");
const router = express.Router();

router.get('/allUsers', getAllUserDetails);

router.get('/analytics', getDashboardMetrics);

module.exports = router;
