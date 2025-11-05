import  Router  from "express";
import { verifyToken } from "../middlewares/auth.middleware.js";
import {
  createOrGetPrivate,
  createGroup,
  listMyConversations,
  getConversation,
  renameGroup,
  addMembers,
  removeMember,
  leaveGroup,
  deleteConversation,
} from "../controllers/conversation.controller.js";

const router = Router();

// Private chat
router.post("/private", verifyToken, createOrGetPrivate);

// Group chat
router.post("/group", verifyToken, createGroup);
router.patch("/:id/name", verifyToken, renameGroup);
router.post("/:id/members", verifyToken, addMembers);
router.delete("/:id/members/:userId", verifyToken, removeMember);
router.post("/:id/leave", verifyToken, leaveGroup);

// Common
router.get("/", verifyToken, listMyConversations);
router.get("/:id", verifyToken, getConversation);
router.delete("/:id", verifyToken, deleteConversation);

export default router;
