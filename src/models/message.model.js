import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
    {
        conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        type: { type: String, enum: ["text", "image", "emoji"], required: true },
        text: { type: String },
        image : { type: String },
        emoji : { type: String },
        recalled: { type: Date, sparse: true },
        deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        meta: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: true }
);
MessageSchema.index({ conversation: 1, createdAt: -1 });

const MessageModel = mongoose.model("Message", MessageSchema);
export default MessageModel;