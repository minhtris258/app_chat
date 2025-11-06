import Router from "express";
import {
  getUserProfile,
  updateUserProfile,
  getUserById
} from "../controllers/user.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/profile", verifyToken, getUserProfile);
router.put("/profile", verifyToken, updateUserProfile);
router.get("/:id", verifyToken, getUserById);

export default router;
