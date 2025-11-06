// src/app.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

// Routers
import UserRouter from "./routes/user.routes.js";
import AuthRouter from "./routes/auth.routes.js";
import FriendRouter from "./routes/friend.routes.js";
import ConversationRouter from "./routes/conversation.routes.js";
import MessageRouter from "./routes/message.routes.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Core middlewares =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: true,          // hoặc ['http://localhost:5173', ...]
    credentials: true,
  })
);
app.use(cookieParser());

// ===== View engine + layouts =====
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/main");

// ===== Static assets =====
// public (CSS/JS của app)
app.use(express.static(path.join(__dirname, "public")));

// vendor (thư viện từ node_modules nếu cần import trực tiếp phía client)
app.use("/vendor", express.static(path.join(__dirname, "..", "node_modules")));

// uploads (nơi multer lưu ảnh): QUAN TRỌNG để client load ảnh đã upload
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ===== Pages =====
app.get("/login", (req, res) =>
  res.render("auth/login", { title: "Đăng nhập" })
);

app.get("/register", (req, res) =>
  res.render("auth/register", { title: "Đăng ký" })
);

// Trang chat chính (SPA/ejs)
app.get("/", (req, res) => {
  res.render("chat/index", {
    title: "Chat App",
    layout: "layouts/main",
  });
});

// ===== APIs =====
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

export default app;
