import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";

import UserRouter from "./routes/UserRoutes.js";
import FriendRouter from "./routes/FriendRoutes.js";

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

app.get("/health/db", (_req, res) => {
  res.json({
    state: mongoose.connection.readyState,
    host: mongoose.connection.host,
    name: mongoose.connection.name,
  });
});

app.get("/", (_req, res) => res.send("API is ready"));



app.use((_req, res) => res.status(404).json({ message: "Endpoint not found" }));

app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({ message: err.message || "Internal Server Error" });
});

export default app;