// index.js
import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import app from "./src/app.js";
import connectDB from "./config/database.js";
import socketInit from "./src/sockets/index.js";

const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();

  // Tạo HTTP server
  const server = http.createServer(app);

  // Khởi tạo Socket.IO
  const io = new Server(server, {
    cors: { origin: "*", credentials: true },
  });

  // Cho phép controller emit tới Socket
  app.set("io", io);

  // Khởi tạo socket handler
  socketInit(io);

  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
};

start();
