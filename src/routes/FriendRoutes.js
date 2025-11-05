import { Router } from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {sendRequest, cancelRequest, respondRequest, unfriend, listFriends, listRequests} from "../controllers/FriendController.js";

const router = Router();

router.post("/send", verifyToken, sendRequest);
router.delete("/cancel", verifyToken, cancelRequest);
router.post("/respond", verifyToken, respondRequest);
router.delete("/unfriend", verifyToken, unfriend);
router.get("/friends", verifyToken, listFriends);
router.get("/requests", verifyToken, listRequests);
export default router;