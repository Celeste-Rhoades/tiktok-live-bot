import { Schema, model } from "mongoose";

export interface IGuildSettings {
  guildId: string;
  alertChannelId: string;
}

const guildSettingsSchema = new Schema<IGuildSettings>(
  {
    guildId: { type: String, required: true, unique: true },
    alertChannelId: { type: String, required: true },
  },
  { timestamps: true },
);

export const GuildSettings = model<IGuildSettings>(
  "GuildSettings",
  guildSettingsSchema,
);
