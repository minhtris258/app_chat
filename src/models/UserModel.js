import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        avatar: { type: String },
        friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        status: { type: String, enum: ["online", "offline", "away"], default: "offline" },
        sockets: [{ type: String }],
    },
    { timestamps: true }
);
const UserModel = mongoose.model("User", UserSchema);
export default UserModel;