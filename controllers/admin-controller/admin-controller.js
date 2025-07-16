const User = require("../../models/User");

const getAllUserDetails = async (req, res) => {
    try {
        const users = await User.find().select("name mobileNumber wallet referralLevels email registrationDate referralCode");

        const userData = await Promise.all(
            users.map(async (user) => {
                const totalReferrals = await User.countDocuments({ referredBy: user._id });
                return {
                    _id: user._id,
                    name: user.name,
                    mobileNumber: user.mobileNumber,
                    email: user.email,
                    wallet: user.wallet,
                    level1_referrals: user.referralLevels.level1.length,
                    level2_referrals: user.referralLevels.level2.length,
                    level3_referrals: user.referralLevels.level3.length,
                    createdAt: user.registrationDate,
                    totalReferrals,
                    uniqueCode: user.referralCode
                };
            })
        );

        res.status(200).json(userData);
    } catch (error) {
        res.status(500).json({ message: "Something went wrong", error });
    }
};

module.exports = {
    getAllUserDetails
};
