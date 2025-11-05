import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

/** GET /api/messages?conversationId=...&limit=30&before=<ObjectId>
 *  - Trả về lịch sử tin nhắn, phân trang bằng cursor (ObjectId giảm dần).
 */
export const listMessages = async (req, res) => {
  const me = req.user?._id;
  const { conversationId, limit = 30, before } = req.query || {};

  if (!conversationId) return res.status(400).json({ error: "Thiếu conversationId" });

  const conv = await Conversation.findById(conversationId).select("_id members");
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

/** POST /api/messages
 * body: { conversationId, type: "text"|"image"|"emoji", text?, image?, emoji?, meta? }
 */
export const sendMessage = async (req, res) => {
  const sender = req.user?._id;
  const { conversationId, type, text, image, emoji, meta } = req.body || {};
  if (!conversationId || !type) return res.status(400).json({ error: "Thiếu dữ liệu" });

  const conv = await Conversation.findById(conversationId).select("_id type members");
  if (!conv) return res.status(404).json({ error: "Không tìm thấy hội thoại" });

  const isMember = conv.members.some((m) => String(m) === String(sender));
  if (!isMember) return res.status(403).json({ error: "Không có quyền" });

  // validate theo type
  if (type === "text" && !String(text || "").trim())
    return res.status(400).json({ error: "Thiếu nội dung text" });
  if (type === "image" && !image)
    return res.status(400).json({ error: "Thiếu image (URL/path)" });
  if (type === "emoji" && !emoji)
    return res.status(400).json({ error: "Thiếu emoji (unicode/shortcode)" });

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
  await Conversation.findByIdAndUpdate(conversationId, { lastMessageAt: new Date() });

  res.json(msg);
};

/** POST /api/messages/:id/recall
 * - Chỉ người gửi mới được thu hồi. Đặt timestamp vào field `recalled`.
 */
export const recallMessage = async (req, res) => {
  const me = req.user?._id;
  const { id } = req.params;

  const msg = await Message.findById(id);
  if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });

  if (String(msg.sender) !== String(me))
    return res.status(403).json({ error: "Bạn không thể thu hồi tin của người khác" });

  msg.recalled = new Date();
  await msg.save();

  res.json({ ok: true, messageId: msg._id, recalledAt: msg.recalled });
};

/** POST /api/messages/:id/deleteForMe
 * - Xóa 1 phía: thêm user vào mảng deletedFor.
 */
export const deleteForMe = async (req, res) => {
  const me = req.user?._id;
  const { id } = req.params;

  const msg = await Message.findById(id).select("_id deletedFor");
  if (!msg) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });

  await Message.updateOne({ _id: id }, { $addToSet: { deletedFor: me } });
  res.json({ ok: true });
};
