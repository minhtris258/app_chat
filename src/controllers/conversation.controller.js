import mongoose from "mongoose";
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";

/** Helper */
const toStr = (id) => String(id);

/** POST /api/conversations/private
 */
// conversation.controller.js (Phần cần sửa)

export const createOrGetPrivate = async (req, res) => {
  const me = req.user._id;
  const { otherUserId } = req.body || {};
  const exists = await User.exists({ _id: otherUserId });
  if (!exists)
    return res.status(404).json({ error: "Người nhận không tồn tại" });
  let conv = await Conversation.findOne({
    type: "private",
    members: { $all: [me, otherUserId], $size: 2 },
  });

  if (!conv) {
    conv = await Conversation.create({
      type: "private",
      members: [me, otherUserId],
    });
    if (req.sendToUser) {
      req.sendToUser(otherUserId, "conversation:new", {
        conversationId: conv._id,
        conv: conv,
      });
      req.sendToUser(me, "conversation:new", {
        conversationId: conv._id,
        conv,
      });
    }
  }

  res.json(conv);
};

/** POST /api/conversations/group
 */
export const createGroup = async (req, res) => {
  const owner = req.user._id;
  const { name, memberIds = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "Thiếu tên nhóm" });

  const uniqueMembers = Array.from(
    new Set([toStr(owner), ...memberIds.map(toStr)])
  ).map((id) => new mongoose.Types.ObjectId(id));

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
  const nextCursor =
    docs.length > 0 ? docs[docs.length - 1].updatedAt?.toISOString() : null;
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
  try {
    const me = req.user._id;
    const { id } = req.params;
    const { name } = req.body || {};

    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
    if (conv.type !== "group")
      return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

    // Chỉ member mới được đổi tên
    const isMember = conv.members.some((m) => toStr(m) === toStr(me));
    if (!isMember) return res.status(403).json({ error: "Không có quyền" });

    await Conversation.updateOne(
      { _id: id },
      { $set: { name: name?.trim() || "" } }
    );

    // Notify members (nếu có sendToUser)
    if (req.sendToUser) {
      const updated = await Conversation.findById(id).select("_id name members");
      (updated.members || []).forEach((m) => {
        try {
          req.sendToUser(m, "conversation:renamed", { conversationId: id, name: updated.name });
        } catch (_) {}
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("renameGroup error:", err);
    return res.status(500).json({ error: err.message || "Lỗi server" });
  }
};

/** POST /api/conversations/:id/members
 */
export const addMembers = async (req, res) => {
  try {
    const me = req.user._id;
    const { id } = req.params;
    const { userIds = [] } = req.body || {};

    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
    if (conv.type !== "group")
      return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

    // Chỉ members mới được thêm (owner hoặc member đều ok)
    const isMember = conv.members.some((m) => toStr(m) === toStr(me));
    if (!isMember) return res.status(403).json({ error: "Không có quyền" });

    // Chuẩn hoá và lọc những id chưa có trong conv
    const existingSet = new Set((conv.members || []).map(toStr));
    const uniqueToAdd = Array.from(new Set(userIds.map(toStr)))
      .filter((uid) => !existingSet.has(uid))
      .map((uid) => new mongoose.Types.ObjectId(uid));

    if (uniqueToAdd.length === 0) return res.json({ ok: true, added: 0 });

    await Conversation.updateOne(
      { _id: id },
      { $addToSet: { members: { $each: uniqueToAdd } } }
    );

    // Notify newly added users + notify existing members about update
    if (req.sendToUser) {
      const updated = await Conversation.findById(id).select("_id name members");
      // notify added users they were added
      uniqueToAdd.forEach((uidObj) => {
        try {
          req.sendToUser(String(uidObj), "conversation:addedToGroup", {
            conversationId: id,
            conv: updated,
          });
        } catch (_) {}
      });
      // notify all members that members list changed
      (updated.members || []).forEach((m) => {
        try {
          req.sendToUser(m, "conversation:membersUpdated", {
            conversationId: id,
            members: updated.members,
          });
        } catch (_) {}
      });
    }

    return res.json({ ok: true, added: uniqueToAdd.length });
  } catch (err) {
    console.error("addMembers error:", err);
    return res.status(500).json({ error: err.message || "Lỗi server" });
  }
};

/** DELETE /api/conversations/:id/members/:userId
 */
export const removeMember = async (req, res) => {
  try {
    const me = req.user._id;
    const { id, userId } = req.params;

    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
    if (conv.type !== "group")
      return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

    // Only members can remove members
    const isMember = conv.members.some((m) => toStr(m) === toStr(me));
    if (!isMember) return res.status(403).json({ error: "Không có quyền" });

    // Owner cannot be removed by anyone (including owner via this endpoint)
    if (toStr(userId) === toStr(conv.owner)) {
      return res.status(400).json({ error: "Không thể gỡ owner" });
    }

    // If target is not in members -> 404/ok
    const targetIsMember = conv.members.some((m) => toStr(m) === toStr(userId));
    if (!targetIsMember) return res.status(404).json({ error: "Người dùng không phải thành viên" });

    // Proceed to pull the user
    await Conversation.updateOne({ _id: id }, { $pull: { members: userId } });

    // Notify remaining members and removed user
    if (req.sendToUser) {
      const updated = await Conversation.findById(id).select("_id name members");
      // notify removed user
      try {
        req.sendToUser(userId, "conversation:removedFromGroup", {
          conversationId: id,
          conv: updated,
        });
      } catch (_) {}
      // notify remaining members
      (updated.members || []).forEach((m) => {
        try {
          req.sendToUser(m, "conversation:membersUpdated", {
            conversationId: id,
            members: updated.members,
          });
        } catch (_) {}
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("removeMember error:", err);
    return res.status(500).json({ error: err.message || "Lỗi server" });
  }
};

/** POST /api/conversations/:id/leave
 */
export const leaveGroup = async (req, res) => {
  const me = req.user._id;
  const { id } = req.params;

  const conv = await Conversation.findById(id);
  if (!conv) return res.status(404).json({ error: "Không tìm thấy" });
  if (conv.type !== "group")
    return res.status(400).json({ error: "Chỉ áp dụng cho nhóm" });

  if (toStr(conv.owner) === toStr(me)) {
    return res.status(400).json({
      error: "Owner không thể rời nhóm, hãy chuyển quyền hoặc xoá nhóm",
    });
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
  return res
    .status(400)
    .json({ error: "Không hỗ trợ xoá cuộc trò chuyện private" });
};
