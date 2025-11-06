import jwt from "jsonwebtoken";

export function socketAuthMiddleware(socket, next) {
  try {
    // Nhận token từ handshake.auth.token hoặc header Authorization
    const bearer = socket.handshake.headers?.authorization || "";
    const token = socket.handshake.auth?.token
      || (bearer.startsWith("Bearer ") ? bearer.slice(7) : "");

    if (!token) return next(new Error("NO_TOKEN"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 5 });

    const id = decoded.id || decoded._id || decoded.userId;
    if (!id) return next(new Error("INVALID_TOKEN_NO_ID"));

    socket.user = { _id: id, ...decoded }; // gắn user cho socket
    next();
  } catch {
    next(new Error("INVALID_TOKEN"));
  }
}