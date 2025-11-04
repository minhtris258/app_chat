import "dotenv/config";
import app from "./src/app.js";
import connectDB from "./config/database.js";

const PORT = process.env.PORT;

const start = async () => {
  await connectDB();                 // kết nối DB trước
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
};

start();