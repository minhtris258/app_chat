// src/app.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import http from 'http'; // 💡 Cần import http
import { Server as SocketIOServer } from 'socket.io'; // 💡 Cần import Socket.IO Server

// 💡 IMPORT CÁC HÀM SOCKET TỪ INDEX.JS
import { socketInit, sendToUser } from "./sockets/index.js"; 

// Routers (GIỮ NGUYÊN)
import UserRouter from "./routes/user.routes.js";
import AuthRouter from "./routes/auth.routes.js";
import FriendRouter from "./routes/friend.routes.js";
import ConversationRouter from "./routes/conversation.routes.js";
import MessageRouter from "./routes/message.routes.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 💡 KHỞI TẠO HTTP SERVER VÀ SOCKET.IO
const server = http.createServer(app);
const io = new SocketIOServer(server, { 
  cors: {
    origin: true,          
    credentials: true,
  }
});

// Chạy logic Socket Listeners
socketInit(io);

// ===== Core middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(cookieParser());


// 🚀 MIDDLEWARE QUAN TRỌNG: Inject Socket vào mọi request API
app.use((req, res, next) => {
    req.io = io; // Gán toàn bộ instance Socket.IO
    // Gán hàm sendToUser, truyền io instance vào bên trong
    req.sendToUser = (userId, eventName, payload) => sendToUser(io, userId, eventName, payload);
    next();
});

// ===== View engine + layouts =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

// ===== Static assets =====
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "..", "node_modules")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ===== Pages =====
app.get("/login", (req, res) =>
  res.render("auth/login", { title: "Đăng nhập" })
);

app.get("/register", (req, res) =>
  res.render("auth/register", { title: "Đăng ký" })
);

app.get("/", (req, res) => {
  res.render("chat/index", {
    title: "Chat App",
    layout: "layouts/main",
  });
});

// ===== APIs (Giờ đã có thể truy cập req.sendToUser và req.io) =====
app.use("/api/auth", AuthRouter);
app.use("/api/user", UserRouter);
app.use("/api/friends", FriendRouter);
app.use("/api/conversations", ConversationRouter);
app.use("/api/messages", MessageRouter);

// ===== Healthcheck nhỏ (tuỳ chọn) =====
app.get("/health", (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "development" })
);

// ===== 404 =====
app.use((_req, res) => res.status(404).json({ message: "Endpoint not found" }));

// ===== Error handler =====
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ message: err.message || "Internal Server Error" });
});

// 💡 EXPORT SERVER HTTP CHỨ KHÔNG PHẢI APP
export default app;