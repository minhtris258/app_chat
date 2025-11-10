import User from "../models/user.model.js";

/** GET /api/user/profile - lấy thông tin người đăng nhập */
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "Người dùng không tìm thấy" });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** PUT /api/user/profile - cập nhật hồ sơ cá nhân */
export const updateUserProfile = async (req, res) => {
  try {
    const { name, avatar, status } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Người dùng không tìm thấy" });

    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    if (status) user.status = status;

    await user.save();
    res.status(200).json({ message: "Cập nhật hồ sơ thành công" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** ✅ GET /api/users/:id - dùng cho chat.js lấy tên người khác */
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("_id username displayName name fullName avatar status online");
    if (!user) return res.status(404).json({ error: "Không tìm thấy user" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
export const listUsers = async (req, res) => {
  try {
    const meId = req.user?.id;                 // từ verifyToken
    const q = (req.query.q || "").trim();
    const cond = { _id: { $ne: meId } };

    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      cond.$or = [
        { username: rx },
        { displayName: rx },
        { name: rx },
        { fullName: rx },
        { email: rx },
      ];
    }

    const users = await User.find(cond)
      .select("_id username displayName name fullName avatar status online")
      .limit(100)
      .lean();

    res.json({ items: users });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
};
