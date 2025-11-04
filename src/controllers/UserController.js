import User from "../models/UserModel.js";

export const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password");
        if (!user) {
            return res.status(404).json({ message: "Người dùng không tìm thấy" });
        }
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
export const updateUserProfile = async (req, res) => {
    try {
        const { name, avatar, status } = req.body;  
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "Người dùng không tìm thấy" });
        }
        if (name) user.name = name;
        if (avatar) user.avatar = avatar;
        if (status) user.status = status;
        await user.save();
        res.status(200).json({ message: "Cập nhật hồ sơ thành công" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
