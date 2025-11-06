import  Router  from "express";
import multer from "multer";
import { verifyToken } from "../middlewares/auth.middleware.js";
import {
  listMessages,
  sendMessage,
  uploadMessageImage,
  recallMessage,
  deleteForMe,
} from "../controllers/message.controller.js";

const router = Router();

const upload = multer({ dest: "uploads/" });

/** Lấy lịch sử tin nhắn (cursor) */
router.get("/", verifyToken, listMessages);

/** Gửi tin nhắn (text/image/emoji) */
router.post("/", verifyToken, sendMessage);
/** Upload hình ảnh tin nhắn */
router.post("/upload", verifyToken, upload.single("file"), uploadMessageImage);

/** Thu hồi tin nhắn */
router.post("/:id/recall", verifyToken, recallMessage);

/** Xóa tin nhắn 1 phía (riêng tôi) */
router.post("/:id/deleteForMe", verifyToken, deleteForMe);

export default router;
