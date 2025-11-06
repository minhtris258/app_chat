// src/sockets/index.js
import jwt from "jsonwebtoken";

/**
 * Khởi tạo Socket.IO cho app.
 * Client nên connect như sau:
 *   io({
 *     withCredentials: true,
 *     auth: { token: "<JWT>" } // hoặc header Authorization: Bearer <JWT>
 *   })
 *
 * Events:
 *  - conversation:join { conversationId | conversation | roomId | convId }
 *  - conversations:join [ids]
 *  - message:new { conversationId | conversation | roomId | convId, ...payload }
 *  - typing:start { conversationId, userId }
 *  - typing:stop  { conversationId, userId }
 *  - (server -> client) typing { conversationId, userId, isTyping }
 *  - (server -> client) user:status { userId, online }
 */
export default function socketInit(io) {
  // ====== Auth middleware (JWT ở handshake) ======
  io.use((socket, next) => {
    try {
      const bearer = socket.handshake.headers?.authorization || "";
      const token =
        socket.handshake.auth?.token ||
        (typeof bearer === "string" && bearer.startsWith("Bearer ")
          ? bearer.slice(7)
          : null);

      if (!token) return next(new Error("Authentication error"));

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "minhtris_secret",
        { clockTolerance: 5 }
      );

      const userId =
        decoded.id || decoded._id || decoded.userId || decoded.uid || null;

      if (!userId) return next(new Error("Invalid token payload"));

      socket.user = {
        id: String(userId),
        username: decoded.username || decoded.name || "user",
      };

      return next();
    } catch (err) {
      return next(new Error("Invalid token"));
    }
  });

  // ====== Quản lý online status (đa tab/đa socket) ======
  // userId -> Set<socketId>
  const onlineUsers = new Map();

  function markOnline(userId, socketId) {
    const set = onlineUsers.get(userId) || new Set();
    set.add(socketId);
    onlineUsers.set(userId, set);
    // nếu trước đó offline (set.size vừa từ 0 -> 1), phát online
    if (set.size === 1) io.emit("user:status", { userId, online: true });
  }

  function markOffline(userId, socketId) {
    const set = onlineUsers.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      onlineUsers.delete(userId);
      io.emit("user:status", { userId, online: false });
    } else {
      onlineUsers.set(userId, set);
    }
  }

  // ====== Connection ======
  io.on("connection", (socket) => {
    const userId = socket.user?.id; // đã chuẩn hóa ở middleware
    console.log(`⚡ Socket connected ${socket.id} user=${socket.user?.username}`);

    // đánh dấu online (đa tab)
    if (userId) markOnline(userId, socket.id);

    // Join 1 phòng
    socket.on("conversation:join", (payload = {}) => {
      const id =
        payload.conversationId ||
        payload.conversation ||
        payload.roomId ||
        payload.convId;
      if (!id) return;
      socket.join(String(id));
    });

    // Join nhiều phòng 1 lượt
    socket.on("conversations:join", (ids = []) => {
      ids.forEach((id) => id && socket.join(String(id)));
    });

    // Realtime message – phát cho các client khác trong phòng
    socket.on("message:new", (msg = {}) => {
      const convId =
        msg.conversationId || msg.conversation || msg.roomId || msg.convId;
      if (!convId) return;
      socket.to(String(convId)).emit("message:new", msg);
    });

    // Typing indicator
    socket.on("typing:start", ({ conversationId, userId: fromClient }) => {
      const convId = conversationId && String(conversationId);
      if (!convId) return;
      socket
        .to(convId)
        .emit("typing", {
          conversationId: convId,
          userId: fromClient || userId, // fallback chính là mình
          isTyping: true,
        });
    });

    socket.on("typing:stop", ({ conversationId, userId: fromClient }) => {
      const convId = conversationId && String(conversationId);
      if (!convId) return;
      socket
        .to(convId)
        .emit("typing", {
          conversationId: convId,
          userId: fromClient || userId,
          isTyping: false,
        });
    });

    // (tuỳ chọn) Client hỏi danh sách đang online
    socket.on("user:whoOnline", (_payload, cb) => {
      try {
        const list = Array.from(onlineUsers.keys());
        cb && cb({ ok: true, users: list });
      } catch (e) {
        cb && cb({ ok: false, error: e?.message || "unknown error" });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Socket disconnected ${socket.id}`);
      if (userId) markOffline(userId, socket.id);
    });
  });
}
