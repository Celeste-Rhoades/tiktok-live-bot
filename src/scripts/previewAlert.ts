import mongoose from "mongoose";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "../config.js";
import { GuildSettings } from "../model/GuildSettings.js";
import {
  TrackedCreator,
  type ITrackedCreator,
} from "../model/TrackedCreator.js";
import {
  buildAlert,
  renderAlertImage,
  sendModeUpdate,
} from "../services/notifier.js";
import type { LiveDetails } from "../types.js";

// Free stock photos, so the test works when nobody is live
const SAMPLE_COVER = "https://picsum.photos/seed/live-cover/720/720";
const SAMPLE_AVATAR = "https://picsum.photos/seed/live-avatar/300/300";

const CARD_TYPES = [
  { label: "Regular", isAgeRestricted: false, isSubOnly: false },
  { label: "18+", isAgeRestricted: true, isSubOnly: false },
  { label: "Super Fan", isAgeRestricted: false, isSubOnly: true },
];

async function sendPreviews(
  client: Client<true>,
  username: string,
  guildId?: string,
) {
  // With a server ID, preview there; without one, use the first server that has a channel set
  const settings = await GuildSettings.findOne(guildId ? { guildId } : {});
  if (!settings) {
    throw new Error(
      guildId
        ? `No alert channel set for server ${guildId}. Run /tiktok setchannel there first.`
        : "No alert channel set. Run /tiktok setchannel first.",
    );
  }

  const channel = await client.channels.fetch(settings.alertChannelId);
  if (!channel || !channel.isSendable()) {
    throw new Error("The bot can't post in the alert channel.");
  }

  const server = client.guilds.cache.get(settings.guildId);
  console.log(`Previewing in ${server?.name ?? settings.guildId}`);

  const tracked = await TrackedCreator.findOne({ guildId: settings.guildId });

  const creator: ITrackedCreator = {
    guildId: settings.guildId,
    tiktokUsername: username,
    // Shown as text only; previews never ping
    roleId: tracked?.roleId ?? settings.guildId,
    isLive: true,
    lastRoomId: "preview",
    lastLive: null,
    alertChannelId: settings.alertChannelId,
    alertMessageId: null,
  };

  let regular: { live: LiveDetails; messageId: string } | null = null;

  for (const type of CARD_TYPES) {
    const live: LiveDetails = {
      roomId: "preview",
      title: `Preview: ${type.label} LIVE`,
      coverUrl: SAMPLE_COVER,
      nickname: "Preview Creator",
      avatarUrl: SAMPLE_AVATAR,
      isAgeRestricted: type.isAgeRestricted,
      isSubOnly: type.isSubOnly,
    };

    const message = await channel.send({
      ...buildAlert(creator, live, await renderAlertImage(live)),
      allowedMentions: { parse: [] },
    });
    console.log(`Sent ${type.label} preview`);

    if (!type.isAgeRestricted && !type.isSubOnly) {
      regular = { live, messageId: message.id };
    }
  }

  // Flip the regular card to Super Fan only to test the edit and the "switched" message
  if (regular) {
    await sendModeUpdate(
      client,
      { ...creator, alertMessageId: regular.messageId },
      { ...regular.live, isSubOnly: true },
    );
    console.log("Sent Super Fan switch preview");
  }
}

async function main() {
  const username = process.argv[2] ?? "mikey.doing.things";
  const guildId = process.argv[3];

  await mongoose.connect(config.mongoUri);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async readyClient => {
    try {
      await sendPreviews(readyClient, username, guildId);
    } catch (error) {
      console.error("Preview failed:", error);
    } finally {
      // Log out and close the database so the script ends on its own
      await client.destroy();
      await mongoose.disconnect();
    }
  });

  await client.login(config.discordToken);
}

void main();
