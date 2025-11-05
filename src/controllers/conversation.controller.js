import mongoose from "mongoose";
import Conversation from "../models/conversation.model";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";

/** Helper */
const toStr = (id) => String(id);

/** POST /api/conversations/private
 */
export const createOrGetPrivate = async (req, res) => {
  const me = req.user._id;
  const { otherUserId } = req.body || {};
  if (!otherUserId || toStr(otherUserId) === toStr(me)) {
    return res.status(400).json({ error: "Người nhận không hợp lệ" });
  }

  const exists = await User.exists({ _id: otherUserId });
  if (!exists) return res.status(404).json({ error: "Người nhận không tồn tại" });
  let conv = await Conversation.findOne({
    type: "private",
    members: { $all: [me, otherUserId], $size: 2 },
  });

  if (!conv) {
    conv = await Conversation.create({
      type: "private",
      members: [me, otherUserId],
    });
  }

  res.json(conv);
};

/** POST /api/conversations/group
 */
export const createGroup = async (req, res) => {
  const owner = req.user._id;
  const { name, memberIds = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "Thiếu tên nhóm" });

  const uniqueMembers = Array.from(new Set([toStr(owner), ...memberIds.map(toStr)])).map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  const conv = await Conversation.create({
    type: "group",
    name: name.trim(),
    owner,
    members: uniqueMembers,
  });

  res.json(conv);
};

/** GET /api/conversations?limit=20&cursor=<ISO or ObjectId>
 */
export const listMyConversations = async (req, res) => {
  const me = req.user._id;
  const { limit = 20, cursor } = req.query || {};

  const q = { members: me };
  if (cursor) {
    const date = new Date(cursor);
    if (!isNaN(date.getTime())) {
      q.updatedAt = { $lt: date };
    } else if (mongoose.isValidObjectId(cursor)) {
      q._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }
  }

  const docs = await Conversation.find(q)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(Math.min(Number(limit) || 20, 100))
    .populate({ path: "lastMessage", model: Message }) // tuỳ thích
    .select("-__v");

  // trả thêm nextCursor
  const nextCursor = docs.length > 0 ? docs[docs.length - 1].updatedAt?.toISOString() : null;
  res.json({ items: docs, nextCursor });
};

/** GET /api/conversations/:id
 */
export const getConversation = async (req, res) => {
  const me = req.user._id;
  const { id } = req.params;

  const conv = await Conversation.findById(id)
    .populate({ path: "lastMessage", model: Message })
    .select("-__v");

  if (!conv) return res.status(404).json({ error: "Không tìm thấy hội thoại" });
  const isMember = conv.members.some((m) => toStr(m) === toStr(me));
  if (!isMember) return res.status(403).json({ error: "Không có quyền" });

  res.json(conv);
};

/** PATCH /api/conversations/:id/name
 */
export const renameGroup = async (req, res) => {
  const me = req.user._id;
  const { id } = req.params;
  const { name } = req.body || {};

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
  if (conv.type !== "group") return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });
  if (toStr(conv.owner) !== toStr(me)) return res.status(403).json({ error: "Chỉ owner được đổi tên nhóm" });

  await Conversation.updateOne({ _id: id }, { $set: { name: name?.trim() || "" } });
  res.json({ ok: true });
};

/** POST /api/conversations/:id/members
 */
export const addMembers = async (req, res) => {
  const me = req.user._id;
  const { id } = req.params;
  const { userIds = [] } = req.body || {};

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
  if (conv.type !== "group") return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

  if (toStr(conv.owner) !== toStr(me)) {
    return res.status(403).json({ error: "Chỉ owner được thêm thành viên" });
  }

  const uniqueToAdd = userIds
    .map(toStr)
    .filter((uid) => !conv.members.map(toStr).includes(uid))
    .map((uid) => new mongoose.Types.ObjectId(uid));

  if (uniqueToAdd.length === 0) return res.json({ ok: true, added: 0 });

  await Conversation.updateOne(
    { _id: id },
    { $addToSet: { members: { $each: uniqueToAdd } } }
  );

  res.json({ ok: true, added: uniqueToAdd.length });
};

/** DELETE /api/conversations/:id/members/:userId
 */
export const removeMember = async (req, res) => {
  const me = req.user._id;
  const { id, userId } = req.params;

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
  if (conv.type !== "group") return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

  if (toStr(conv.owner) !== toStr(me)) {
    return res.status(403).json({ error: "Chỉ owner được gỡ thành viên" });
  }

  // Owner không thể tự gỡ chính mình bằng API này
  if (toStr(userId) === toStr(conv.owner)) {
    return res.status(400).json({ error: "Không thể gỡ owner" });
  }

  await Conversation.updateOne({ _id: id }, { $pull: { members: userId } });
  res.json({ ok: true });
};

/** POST /api/conversations/:id/leave
 */
export const leaveGroup = async (req, res) => {
  const me = req.user._id;
  const { id } = req.params;

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
  if (conv.type !== "group") return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

  if (toStr(conv.owner) === toStr(me)) {
    return res.status(400).json({ error: "Owner không thể rời nhóm, hãy chuyển quyền hoặc xoá nhóm" });
  }

  await Conversation.updateOne({ _id: id }, { $pull: { members: me } });
  res.json({ ok: true });
};

/** DELETE /api/conversations/:id */
export const deleteConversation = async (req, res) => {
  const me = req.user._id;
  const { id } = req.params;

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy" });

  if (conv.type === "group") {
    if (toStr(conv.owner) !== toStr(me))
      return res.status(403).json({ error: "Chỉ owner được xoá nhóm" });
    await conv.deleteOne();
    return res.json({ ok: true });
  }

  // với private: tuỳ policy (ở đây: không hỗ trợ xoá)
  return res.status(400).json({ error: "Không hỗ trợ xoá cuộc trò chuyện private" });
};
