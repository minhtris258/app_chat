import  Router  from "express";
import { verifyToken } from "../middlewares/auth.middleware.js";
import {
  listMessages,
  sendMessage,
  recallMessage,
  deleteForMe,
} from "../controllers/message.controller.js";

const router = Router();

/** Lấy lịch sử tin nhắn (cursor) */
router.get("/", verifyToken, listMessages);

/** Gửi tin nhắn (text/image/emoji) */
router.post("/", verifyToken, sendMessage);

/** Thu hồi tin nhắn */
router.post("/:id/recall", verifyToken, recallMessage);

/** Xóa tin nhắn 1 phía (riêng tôi) */
router.post("/:id/deleteForMe", verifyToken, deleteForMe);

export default router;
