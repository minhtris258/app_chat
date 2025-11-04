import  Router  from "express";
import { registerUser, loginUser , logoutUser } from "../controllers/AuthController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";  

const router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout", verifyToken, logoutUser);

export default router;