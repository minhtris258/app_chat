import User from "../models/user.model.js";
import FriendRequest from "../models/friendrequest.model.js";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

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
    const userId = req.user.id;      // người nhận lời mời
    const { from, action } = req.body; // action: accept | reject

    const fr = await FriendRequest.findOne({
      from,
      to: userId,
      status: "pending",
    });
    if (!fr) return res.status(404).json({ message: "Không tìm thấy lời mời" });

    if (action === "accept") {
      // 1) Cập nhật trạng thái & danh sách bạn
      fr.status = "accepted";
      await fr.save();
      await User.updateOne({ _id: from },   { $addToSet: { friends: userId } });
      await User.updateOne({ _id: userId }, { $addToSet: { friends: from } });

      // 2) Tạo (hoặc lấy) hội thoại private 2 người
      let conv = await Conversation.findOne({
        type: "private",
        members: { $all: [from, userId], $size: 2 },
      });

      if (!conv) {
        conv = await Conversation.create({
          type: "private",
          members: [from, userId],
        });
      }

      // 3) Tạo tin nhắn chào mừng “đã là bạn”
      const text = "🎉 Hai bạn đã trở thành bạn bè!";
      const msg = await Message.create({
        conversation: conv._id,
        sender: userId,         // cho hệ thống: có thể để người chấp nhận gửi
        type: "text",
        text,
        meta: { system: true, kind: "friend-accepted" },
      });

      // cập nhật lastMessage để sidebar có preview luôn
      await Conversation.findByIdAndUpdate(conv._id, { $set: { lastMessage: msg._id } });

      // 4) Bắn sự kiện socket để cả hai bên reload sidebar ngay (không cần F5)
      if (req.sendToUser) {
        req.sendToUser(from,   "conversation:new",    { conversationId: conv._id, conv });
        req.sendToUser(userId, "conversation:new",    { conversationId: conv._id, conv });
        // (tuỳ chọn) đẩy thêm 1 “message:new” để bên đối phương thấy message đầu tiên liền
        req.sendToUser(from,   "message:new",         { ...msg.toObject(), conversationId: conv._id });
        req.sendToUser(userId, "message:new",         { ...msg.toObject(), conversationId: conv._id });
      }

      return res.status(200).json({ message: "Đã chấp nhận", conversationId: conv._id });
    }

    if (action === "reject") {
      fr.status = "rejected";
      await fr.save();
      return res.status(200).json({ message: "Đã từ chối" });
    }

    return res.status(400).json({ message: "Hành động không hợp lệ" });
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
