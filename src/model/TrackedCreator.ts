import { Schema, model } from "mongoose";

export interface ITrackedCreator {
  guildId: string;
  tiktokUsername: string;
  roleId: string;
  isLive: boolean;
  lastRoomId: string | null;
}

const trackedCreatorSchema = new Schema<ITrackedCreator>(
  {
    guildId: { type: String, required: true, index: true },
    tiktokUsername: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    roleId: { type: String, required: true },
    isLive: { type: Boolean, default: false },
    lastRoomId: { type: String, default: null },
  },
  { timestamps: true },
);

// Same creator can be tracked in both servers, but only once per server
trackedCreatorSchema.index({ guildId: 1, tiktokUsername: 1 }, { unique: true });

export const TrackedCreator = model<ITrackedCreator>(
  "TrackedCreator",
  trackedCreatorSchema,
);
