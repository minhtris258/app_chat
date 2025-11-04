import mongoose from "mongoose";

const connectDB = async () => {
  try {
    mongoose.connection.on("connected", () => console.log("MongoDB connected"));
    mongoose.connection.on("error", (err) => console.error("MongoDB error:", err.message));
    mongoose.connection.on("disconnected", () => console.log("MongoDB disconnected"));

    await mongoose.connect(process.env.MONGO_URI, {
        dbName: "app-chat",
      serverSelectionTimeoutMS: 5000,
    });
  } catch (error) {
    console.error("ConnectDB failed:", error.message);
    process.exit(1);
  }
};

export default connectDB;