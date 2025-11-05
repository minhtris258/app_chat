import mongoose from "mongoose";

const ConversationSchema = new mongoose.Schema(
    {
        type: { type: String, enum: ["private", "group"], required: true },
        name: { type: String, trim: true , sparse: true },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
        lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },

    },
    { timestamps: true }
);

const ConversationModel = mongoose.model("Conversation", ConversationSchema);
export default ConversationModel;