import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

/** GET /api/messages?conversationId=...&limit=30&before=<ObjectId> */
export const listMessages = async (req, res) => {
  const me = req.user?._id;
  const { conversationId, limit = 30, before } = req.query || {};

  if (!conversationId)
    return res.status(400).json({ error: "Thiếu conversationId" });

  const conv = await Conversation.findById(conversationId).select(
    "_id members"
  );
  if (!conv) return res.status(404).json({ error: "Không tìm thấy hội thoại" });

  const isMember = conv.members.some((m) => String(m) === String(me));
  if (!isMember) return res.status(403).json({ error: "Không có quyền" });

  const q = {
    conversation: conversationId,
    deletedFor: { $ne: me }, // ẩn tin đã xóa 1 phía
  };
  if (before && mongoose.isValidObjectId(before)) {
    q._id = { $lt: new mongoose.Types.ObjectId(before) };
  }

  const docs = await Message.find(q)
    .sort({ _id: -1 })
    .limit(Math.min(Number(limit) || 30, 100)); // chặn max 100

  res.json(docs);
};

/** POST /api/messages */
export const sendMessage = async (req, res) => {
  const sender = req.user?._id;
  const { conversationId, type, text, image, emoji, meta } = req.body || {};
  if (!conversationId || !type)
    return res.status(400).json({ error: "Thiếu dữ liệu" });

  const conv = await Conversation.findById(conversationId).select(
    "_id type members"
  );
  if (!conv) return res.status(404).json({ error: "Không tìm thấy hội thoại" });

  const isMember = conv.members.some((m) => String(m) === String(sender));
  if (!isMember) return res.status(403).json({ error: "Không có quyền" });
  
  const payload = {
    conversation: conversationId,
    sender,
    type,
    meta: meta || undefined,
  };
  if (type === "text") payload.text = String(text).trim();
  if (type === "image") payload.image = image;
  if (type === "emoji") payload.emoji = emoji;

  const msg = await Message.create(payload);
  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessageAt: new Date(),
  });
  
  // Xác định người nhận và gửi sự kiện Socket
  const receiverId = conv.members.find((m) => String(m) !== String(sender));

  if (receiverId && req.sendToUser) {
    // 💡 Thông báo cho người nhận cập nhật sidebar (Test 2)
    req.sendToUser(receiverId, "conversation:update", {
      conversationId: conv._id,
    });
  }
  if (req.io) {
    // Gửi tin nhắn đến các client đã join phòng (Test 1)
    req.io
      .to(String(conversationId))
      .emit("message:new", { ...msg.toObject(), sender });
  }

  res.json(msg);
};

// POST /api/messages/upload
export const uploadMessageImage = async (req, res, next) => {
  try {
    const sender = req.user?._id;
    const { conversationId } = req.body;

    // 💡 SỬA LỖI: CẦN TẢI CONV VÀ KIỂM TRA QUYỀN
    const conv = await Conversation.findById(conversationId).select(
      "_id type members"
    );
    if (!conv) return res.status(404).json({ error: "Không tìm thấy hội thoại" });
    const isMember = conv.members.some((m) => String(m) === String(sender));
    if (!isMember) return res.status(403).json({ error: "Không có quyền" });
    // HẾT SỬA LỖI


    if (!req.file) return res.status(400).json({ error: "Không tìm thấy file" });

    // Path là /uploads/ten_file. Gợi ý: file đã được lưu trong req.file.filename
    const imagePath = `/uploads/${req.file.filename}`;

    const msg = await Message.create({
      conversation: conversationId,
      sender,
      type: "image",
      image: imagePath,
    });

    // cập nhật thời gian hoạt động gần nhất của hội thoại
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessageAt: new Date(),
    });

    // Xác định người nhận và gửi sự kiện Socket
    const receiverId = conv.members.find((m) => String(m) !== String(sender));

    if (receiverId && req.sendToUser) {
      req.sendToUser(receiverId, "conversation:update", {
        conversationId: conv._id,
      });
    }

    if (req.io) {
      req.io
        .to(String(conversationId))
        .emit("message:new", { ...msg.toObject(), sender });
    }
    res.json(msg);
  } catch (err) {
    next(err);
  }
};

/** POST /api/messages/:id/recall */
export const recallMessage = async (req, res) => {
  const me = req.user?._id;
  const { id } = req.params;

  const msg = await Message.findById(id);
  if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });

  if (String(msg.sender) !== String(me))
    return res
      .status(403)
      .json({ error: "Bạn không thể thu hồi tin của người khác" });

  msg.recalled = new Date();
  await msg.save();

  // Cần thêm logic Socket thông báo thu hồi tin nhắn đến người nhận
  // (Không thực hiện ở đây vì không phải yêu cầu chính, nhưng cần lưu ý)

  res.json({ ok: true, messageId: msg._id, recalledAt: msg.recalled });
};

/** POST /api/messages/:id/deleteForMe */
export const deleteForMe = async (req, res) => {
  const me = req.user?._id;
  const { id } = req.params;

  const msg = await Message.findById(id).select("_id deletedFor");
  if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });

  await Message.updateOne({ _id: id }, { $addToSet: { deletedFor: me } });
  res.json({ ok: true });
};