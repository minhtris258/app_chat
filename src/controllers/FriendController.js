import User from "../models/UserModel.js";
import FriendRequest from "../models/FriendRequestModel.js";


export const sendRequest = async (req, res) => {
  try {
    const from = req.user.id;
    const { to } = req.body;

    if (!to || from === to)
      return res.status(400).json({ message: "Yêu cầu không hợp lệ" });
    const exist = await FriendRequest.findOne({ from, to });
    if (exist) return res.status(400).json({ message: "Yêu cầu đã tồn tại" });

    await FriendRequest.create({ from, to });
    res.status(201).json({ message: "Đã gửi yêu cầu kết bạn" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const cancelRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { to } = req.body;
    const request = await FriendRequest.findOneAndDelete({
      from: userId,
      to,
      status: "pending",
    });
    if (!request)
      return res.status(404).json({ message: "Yêu cầu không tồn tại" });
    res.status(200).json({ message: "Đã hủy yêu cầu kết bạn" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const respondRequest = async (req, res) => {
  try {
    const userId = req.user.id; // người nhận
    const { from, action } = req.body; // action: accept | reject

    const fr = await FriendRequest.findOne({
      from,
      to: userId,
      status: "pending",
    });
    if (!fr) return res.status(404).json({ message: "Không tìm thấy lời mời" });

    if (action === "accept") {
      fr.status = "accepted";
      await fr.save();
      // cập nhật danh sách bạn
      await User.updateOne({ _id: from }, { $addToSet: { friends: userId } });
      await User.updateOne({ _id: userId }, { $addToSet: { friends: from } });
      return res.status(200).json({ message: "Đã chấp nhận" });
    } else if (action === "reject") {
      fr.status = "rejected";
      await fr.save();
      return res.status(200).json({ message: "Đã từ chối" });
    } else {
      return res.status(400).json({ message: "Hành động không hợp lệ" });
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const unfriend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body;
    await User.updateOne({ _id: userId }, { $pull: { friends: friendId } });
    await User.updateOne({ _id: friendId }, { $pull: { friends: userId } });
    res.status(200).json({ message: "Đã hủy kết bạn" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const listFriends = async (req, res) => {
  try {
    const me = await User.findById(req.user.id).populate(
      "friends",
      "name email avatar status"
    );
    res.status(200).json(me.friends);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
export const listRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const incoming = await FriendRequest.find({
      to: userId,
      status: "pending",
    }).populate("from", "name email avatar");
    const outgoing = await FriendRequest.find({
      from: userId,
      status: "pending",
    }).populate("to", "name email avatar");
    return res.status(200).json({ incoming, outgoing });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};