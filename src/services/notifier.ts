import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  type Client,
  type Message,
} from "discord.js";
import { GuildSettings } from "../model/GuildSettings.js";
import type { ITrackedCreator } from "../model/TrackedCreator.js";
import type { LiveDetails } from "../types.js";
import { addGlowFrame } from "./glowFrame.js";

// Card colors by LIVE type; change these to restyle every alert
const COLORS = {
  regular: 0x00ffff,
  ageRestricted: 0xff00ff,
  superFan: 0x39ff14,
} as const;

// Discord rejects embed titles over 256 characters
const MAX_TITLE_LENGTH = 256;

// Name the framed image is uploaded under, so the embed can point at it
const IMAGE_FILE_NAME = "live.png";

export interface SentAlert {
  channelId: string;
  messageId: string;
}

function getLabels(live: LiveDetails): string[] {
  const labels: string[] = [];
  if (live.isAgeRestricted) labels.push("18+");
  if (live.isSubOnly) labels.push("Super Fan only");
  return labels;
}

function getColor(live: LiveDetails): number {
  if (live.isAgeRestricted) return COLORS.ageRestricted;
  if (live.isSubOnly) return COLORS.superFan;
  return COLORS.regular;
}

// 18+ always uses the profile picture; regular LIVEs prefer the stream cover
function getImage(live: LiveDetails): string | null {
  if (live.isAgeRestricted) return live.avatarUrl;
  return live.coverUrl ?? live.avatarUrl;
}

function getLiveUrl(creator: ITrackedCreator): string {
  return `https://www.tiktok.com/@${creator.tiktokUsername}/live`;
}

// Creator names can contain * or _, which would otherwise scramble the bold text
function safeName(live: LiveDetails): string {
  return escapeMarkdown(live.nickname);
}

async function getAlertChannel(client: Client, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isSendable()) return null;
  return channel;
}

// Frame once per stream and share it, instead of once per server
export async function renderAlertImage(
  live: LiveDetails,
): Promise<Buffer | null> {
  const imageUrl = getImage(live);
  return imageUrl ? addGlowFrame(imageUrl) : null;
}

// Shared by new alerts, edits, and the preview script, so every card looks the same
export function buildAlert(
  creator: ITrackedCreator,
  live: LiveDetails,
  framedImage: Buffer | null,
) {
  const liveUrl = getLiveUrl(creator);
  const labels = getLabels(live);
  const labelText = labels.length ? ` (${labels.join(", ")})` : "";

  const embed = new EmbedBuilder()
    .setColor(getColor(live))
    .setAuthor({
      name: live.nickname,
      iconURL: live.avatarUrl ?? undefined,
      url: liveUrl,
    })
    .setTitle(live.title.slice(0, MAX_TITLE_LENGTH))
    .setURL(liveUrl)
    .setTimestamp();

  const files: AttachmentBuilder[] = [];
  const plainImage = getImage(live);

  if (framedImage) {
    // Upload the framed image with the message and point the embed at it
    files.push(new AttachmentBuilder(framedImage, { name: IMAGE_FILE_NAME }));
    embed.setImage(`attachment://${IMAGE_FILE_NAME}`);
  } else if (plainImage) {
    embed.setImage(plainImage);
  }

  const watchButton = new ButtonBuilder()
    .setLabel("Watch Stream")
    .setStyle(ButtonStyle.Link)
    .setURL(liveUrl);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    watchButton,
  );

  return {
    content: `<@&${creator.roleId}> **${safeName(live)}** is LIVE${labelText}!`,
    embeds: [embed],
    components: [buttons],
    files,
  };
}

export async function sendLiveAlert(
  client: Client,
  creator: ITrackedCreator,
  live: LiveDetails,
  framedImage: Buffer | null,
): Promise<SentAlert | null> {
  const settings = await GuildSettings.findOne({ guildId: creator.guildId });
  if (!settings) {
    console.warn(`No alert channel set for server ${creator.guildId}`);
    return null;
  }

  const channel = await getAlertChannel(client, settings.alertChannelId);
  if (!channel) {
    console.warn(
      `Can't post in channel ${settings.alertChannelId} (server ${creator.guildId})`,
    );
    return null;
  }

  // Only ping the role chosen for this creator, never @everyone
  const allowedMentions = { roles: [creator.roleId] };
  let message: Message;

  try {
    message = await channel.send({
      ...buildAlert(creator, live, framedImage),
      allowedMentions,
    });
  } catch (error) {
    if (!framedImage) throw error;

    // Usually a missing Attach Files permission; a plain image link needs no upload
    console.warn(
      `Glow image upload failed in server ${creator.guildId}, sending the plain image:`,
      error,
    );
    message = await channel.send({
      ...buildAlert(creator, live, null),
      allowedMentions,
    });
  }

  return { channelId: channel.id, messageId: message.id };
}

// A LIVE switched to or from Super Fan only after the alert went out
export async function sendModeUpdate(
  client: Client,
  creator: ITrackedCreator,
  live: LiveDetails,
) {
  const channelId =
    creator.alertChannelId ??
    (await GuildSettings.findOne({ guildId: creator.guildId }))?.alertChannelId;
  if (!channelId) return;

  const channel = await getAlertChannel(client, channelId);
  if (!channel) {
    console.warn(
      `Can't post in channel ${channelId} (server ${creator.guildId})`,
    );
    return;
  }

  // Edits never ping anyone, so the original card can be refreshed quietly
  if (creator.alertMessageId) {
    const framedImage = await renderAlertImage(live);
    try {
      await channel.messages.edit(creator.alertMessageId, {
        ...buildAlert(creator, live, framedImage),
        // Drop the old image so the card doesn't end up with two
        attachments: [],
        allowedMentions: { parse: [] },
      });
    } catch {
      try {
        // Retry with the plain image in case the upload was the problem
        await channel.messages.edit(creator.alertMessageId, {
          ...buildAlert(creator, live, null),
          attachments: [],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.warn(
          `Couldn't update the alert card for @${creator.tiktokUsername}:`,
          error,
        );
      }
    }
  }

  const change = live.isSubOnly
    ? `**${safeName(live)}** switched their LIVE to Super Fan only.`
    : `**${safeName(live)}** opened their LIVE back up to everyone.`;

  await channel.send({
    content: `${change} <${getLiveUrl(creator)}>`,
    allowedMentions: { parse: [] },
  });
}
