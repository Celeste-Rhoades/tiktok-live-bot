import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
} from "discord.js";
import { GuildSettings } from "../model/GuildSettings.js";
import type { ITrackedCreator } from "../model/TrackedCreator.js";
import type { LiveDetails } from "../types.js";

// Card colors by LIVE type; change these to restyle every alert
const COLORS = {
  regular: 0x00ffff,
  ageRestricted: 0xff00ff,
  superFan: 0xc87df2,
} as const;

// Discord rejects embed titles over 256 characters
const MAX_TITLE_LENGTH = 256;

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

export async function sendLiveAlert(
  client: Client,
  creator: ITrackedCreator,
  live: LiveDetails,
) {
  const settings = await GuildSettings.findOne({ guildId: creator.guildId });
  if (!settings) {
    console.warn(`No alert channel set for server ${creator.guildId}`);
    return;
  }

  const channel = await client.channels.fetch(settings.alertChannelId);
  if (!channel || !channel.isSendable()) {
    console.warn(
      `Can't post in channel ${settings.alertChannelId} (server ${creator.guildId})`,
    );
    return;
  }

  const liveUrl = `https://www.tiktok.com/@${creator.tiktokUsername}/live`;
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

  const image = getImage(live);
  if (image) embed.setImage(image);

  const watchButton = new ButtonBuilder()
    .setLabel("Watch Stream")
    .setStyle(ButtonStyle.Link)
    .setURL(liveUrl);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    watchButton,
  );

  await channel.send({
    content: `<@&${creator.roleId}> **${live.nickname}** is LIVE${labelText}!`,
    embeds: [embed],
    components: [buttons],
    // Only ping the role chosen for this creator, never @everyone
    allowedMentions: { roles: [creator.roleId] },
  });
}
