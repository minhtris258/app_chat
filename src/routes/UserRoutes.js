import  Router  from "express";
import { getUserProfile , updateUserProfile } from "../controllers/UserController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";  

const router = Router();

router.get("/profile", verifyToken, getUserProfile);
router.put("/profile", verifyToken, updateUserProfile);


export default router;