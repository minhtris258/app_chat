// index.js (PHIÊN BẢN ĐÃ SỬA LỖI VÀ HOÀN THIỆN INJECTION)
import "dotenv/config";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
// Giả sử './src/app.js' export default app
import app from "./src/app.js"; 
import connectDB from "./config/database.js";
import { socketInit, sendToUser } from "./src/sockets/index.js";

const PORT = process.env.PORT || 3000;

const start = async () => {
    await connectDB();
    
    // 🚀 KHẮC PHỤC LỖI: INJECT SOCKET VÀO EXPRESS MIDDLEWARE
    // Logic này phải chạy sau khi Express được khởi tạo nhưng trước khi server chạy.
    // Tạm thời chỉ gán req.io và req.sendToUser để tránh lỗi.
    // LƯU Ý: Biến 'io' sẽ được định nghĩa sau, nhưng hàm middleware này được định nghĩa trước.
    app.use((req, res, next) => { 
        // Chúng ta sẽ gán 'io' và 'sendToUser' sau khi khởi tạo chúng
        // Hàm này sẽ được gọi khi request API được gửi
        req.io = io; 
        req.sendToUser = (userId, eventName, payload) => sendToUser(io, userId, eventName, payload);
        next();
    });
    
    // 1. Tạo HTTP server
    const server = http.createServer(app);

    // 2. Khởi tạo Socket.IO
    const io = new SocketIOServer(server, {
        cors: { origin: "*", credentials: true },
    });

    // 3. Khởi tạo socket handler (listeners)
    socketInit(io);

    server.listen(PORT, () => {
        console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
};

start();