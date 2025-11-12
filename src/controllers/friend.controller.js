import User from "../models/user.model.js";
import FriendRequest from "../models/friendrequest.model.js";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

/* =============================
   Gửi yêu cầu kết bạn
============================= */
export const sendRequest = async (req, res) => {
  try {
    const from = req.user._id;
    const { to } = req.body;

    if (!to || from === to)
      return res.status(400).json({ message: "Yêu cầu không hợp lệ" });

    const exist = await FriendRequest.findOne({ from, to });
    if (exist)
      return res.status(400).json({ message: "Yêu cầu đã tồn tại" });

    await FriendRequest.create({ from, to });
    res.status(201).json({ message: "Đã gửi yêu cầu kết bạn" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =============================
   Hủy yêu cầu
============================= */
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

/* =============================
   Chấp nhận / Từ chối
============================= */
export const respondRequest = async (req, res) => {
  try {
    const userId = req.user.id; // người nhận
    const { from, action } = req.body;

    const fr = await FriendRequest.findOne({
      from,
      to: userId,
      status: "pending",
    });

    if (!fr)
      return res.status(404).json({ message: "Không tìm thấy lời mời" });

    if (action === "accept") {
      fr.status = "accepted";
      await fr.save();

      // cập nhật danh sách bạn
      await User.updateOne({ _id: from }, { $addToSet: { friends: userId } });
      await User.updateOne({ _id: userId }, { $addToSet: { friends: from } });

      /* =============================
         TẠO / LẤY HỘI THOẠI PRIVATE
      ============================== */
      let conv = await Conversation.findOne({
        type: "private",
        members: { $all: [from, userId], $size: 2 },
      });

      if (!conv) {
        conv = await Conversation.create({
          type: "private",
          members: [from, userId],
        });

        // tin nhắn hệ thống
        const sysMsg = await Message.create({
          conversation: conv._id,
          sender: userId,
          type: "text",
          text: "Hai bạn đã trở thành bạn bè 🎉",
        });

        await Conversation.updateOne(
          { _id: conv._id },
          {
            $set: { lastMessage: sysMsg._id },
            $currentDate: { updatedAt: true },
          }
        );
      } else {
        await Conversation.updateOne(
          { _id: conv._id },
          { $currentDate: { updatedAt: true } }
        );
      }

      /* =============================
         ✅ POPULATE ĐẦY ĐỦ ĐỂ FRONTEND
         HIỂN THỊ KHÔNG CẦN F5
      ============================== */
      const convFull = await Conversation.findById(conv._id)
        .populate("members", "name email avatar")
        .populate("lastMessage")
        .lean();

      /* =============================
         ✅ EMIT SOCKET TỚI CẢ 2 NGƯỜI
      ============================== */
      if (req.sendToUser) {
        req.sendToUser(String(from), "conversation:new", {
          conversationId: conv._id,
          conv: convFull,
        });

        req.sendToUser(String(userId), "conversation:new", {
          conversationId: conv._id,
          conv: convFull,
        });
      }

      return res.status(200).json({
        message: "Đã chấp nhận",
        conversation: convFull,
      });
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

/* =============================
   Hủy kết bạn
============================= */
export const unfriend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body;

    if (!friendId) {
      return res.status(400).json({ message: "Thiếu friendId" });
    }

    // 1) Gỡ bạn trong cả 2 user
    await User.updateOne({ _id: userId }, { $pull: { friends: friendId } });
    await User.updateOne({ _id: friendId }, { $pull: { friends: userId } });

    // 2) Xoá mọi request liên quan giữa 2 user (cả 2 chiều)
    // Giả sử bạn có model FriendRequest với fields: from, to, status, ...
    await FriendRequest.deleteMany({
      $or: [
        { from: userId, to: friendId },
        { from: friendId, to: userId },
      ],
    });

    // 3) (Tuỳ chọn) nếu bạn lưu các mảng khác (ví dụ pendingRequests) trong User,
    // có thể cần pull thêm ở đây.

    return res.status(200).json({ message: "Đã huỷ kết bạn và xoá yêu cầu liên quan" });
  } catch (error) {
    console.error("unfriend error:", error);
    return res.status(500).json({ message: error.message || "Lỗi server" });
  }
};

/* =============================
   Lấy danh sách bạn
============================= */
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

/* =============================
   Lấy yêu cầu kết bạn
============================= */
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
