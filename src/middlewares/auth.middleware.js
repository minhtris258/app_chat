import jwt from "jsonwebtoken";

export const verifyToken = (req, res, next) => {
  const headerVal = req.headers.authorization || req.headers.Authorization;
  let token = null;

  if (typeof headerVal === "string" && headerVal.startsWith("Bearer ")) {
    token = headerVal.slice(7);
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) return res.status(401).json({ message: "Chưa đăng nhập" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { clockTolerance: 5 });

    // 🔧 CHUẨN HÓA ID → `_id`
    const id = decoded.id || decoded._id || decoded.userId;
    if (!id) return res.status(401).json({ message: "Token không hợp lệ: thiếu id" });

    // Gắn dạng thống nhất
    req.user = { _id: id, ...decoded };
    return next();
  } catch {
    return res.status(401).json({ message: "Token không hợp lệ hoặc đã hết hạn" });
  }
};
