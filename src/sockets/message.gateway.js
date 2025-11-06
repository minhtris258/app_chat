// /src/sockets/message.gateway.js
import Conversation from "../models/conversation.model.js";
import Message from "../models/message.model.js";

export default function messageGateway(io, socket) {
  const userId = String(socket.user._id);

  // Gửi tin nhắn
  socket.on("message:send", async (payload, ack) => {
    try {
      const { conversationId, type, text, image, emoji, meta } = payload || {};
      if (!conversationId || !type) return ack?.({ ok: false, error: "MISSING_FIELDS" });

      const conv = await Conversation.findById(conversationId).select("_id members");
      if (!conv) return ack?.({ ok: false, error: "CONV_NOT_FOUND" });

      const isMember = conv.members.some((m) => String(m) === userId);
      if (!isMember) return ack?.({ ok: false, error: "NO_PERMISSION" });

      // validate cơ bản theo type (đồng bộ với controller của bạn)
      if (type === "text" && !String(text || "").trim()) return ack?.({ ok: false, error: "EMPTY_TEXT" });
      if (type === "image" && !image) return ack?.({ ok: false, error: "NO_IMAGE" });
      if (type === "emoji" && !emoji) return ack?.({ ok: false, error: "NO_EMOJI" });

      const doc = { conversation: conversationId, sender: userId, type, meta: meta || undefined };
      if (type === "text")  doc.text = String(text).trim();
      if (type === "image") doc.image = image;
      if (type === "emoji") doc.emoji = emoji;

      const msg = await Message.create(doc);
      await Conversation.findByIdAndUpdate(conversationId, { lastMessage: msg._id, updatedAt: new Date() });

      io.to(`conv:${conversationId}`).emit("message:new", msg);
      ack?.({ ok: true, message: msg });
    } catch (e) {
      ack?.({ ok: false, error: "SERVER_ERROR" });
    }
  });

  // Thu hồi tin nhắn
  socket.on("message:recall", async ({ messageId }, ack) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return ack?.({ ok: false, error: "MSG_NOT_FOUND" });
      if (String(msg.sender) !== userId) return ack?.({ ok: false, error: "NO_PERMISSION" });

      msg.recalled = new Date();
      await msg.save();
      io.to(`conv:${msg.conversation}`).emit("message:recalled", { messageId: msg._id, recalledAt: msg.recalled });
      ack?.({ ok: true });
    } catch {
      ack?.({ ok: false, error: "SERVER_ERROR" });
    }
  });

  // Typing
  socket.on("typing:start", ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit("typing", { conversationId, userId, isTyping: true });
  });
  socket.on("typing:stop", ({ conversationId }) => {
    socket.to(`conv:${conversationId}`).emit("typing", { conversationId, userId, isTyping: false });
  });
}
