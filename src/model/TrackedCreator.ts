import { Schema, model } from "mongoose";
import type { LiveDetails } from "../types.js";

export interface ITrackedCreator {
  guildId: string;
  tiktokUsername: string;
  roleId: string;
  isLive: boolean;
  lastRoomId: string | null;
  // What the last alert announced, so mid-stream changes can be spotted
  lastLive: LiveDetails | null;
  // Where that alert was posted, so the card can be edited later
  alertChannelId: string | null;
  alertMessageId: string | null;
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
    lastLive: { type: Schema.Types.Mixed, default: null },
    alertChannelId: { type: String, default: null },
    alertMessageId: { type: String, default: null },
  },
  { timestamps: true },
);

// Same creator can be tracked in both servers, but only once per server
trackedCreatorSchema.index({ guildId: 1, tiktokUsername: 1 }, { unique: true });

export const TrackedCreator = model<ITrackedCreator>(
  "TrackedCreator",
  trackedCreatorSchema,
);
