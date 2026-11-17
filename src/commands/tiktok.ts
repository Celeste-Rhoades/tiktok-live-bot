import {
  ChannelType,
  ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { mongo } from "mongoose";
import { GuildSettings } from "../model/GuildSettings.js";
import { TrackedCreator } from "../model/TrackedCreator.js";
import { lookupCreator } from "../services/liveChecker.js";

export const tiktokCommand = new SlashCommandBuilder()
  .setName("tiktok")
  .setDescription("Manage TikTok LIVE alerts")
  // Only members with Manage Server can see or use these commands
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand(sub =>
    sub
      .setName("setchannel")
      .setDescription("Choose the channel where LIVE alerts are posted")
      .addChannelOption(option =>
        option
          .setName("channel")
          .setDescription("The alert channel")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName("add")
      .setDescription("Start tracking a TikTok creator")
      .addStringOption(option =>
        option
          .setName("username")
          .setDescription("TikTok username, with or without @")
          .setRequired(true),
      )
      .addRoleOption(option =>
        option
          .setName("role")
          .setDescription("Role to ping when they go live")
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName("remove")
      .setDescription("Stop tracking a TikTok creator")
      .addStringOption(option =>
        option
          .setName("username")
          .setDescription("TikTok username")
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub.setName("list").setDescription("Show creators tracked in this server"),
  );

// TikTok usernames: letters, numbers, periods, underscores, 2–24 characters
const USERNAME_PATTERN = /^[a-z0-9._]{2,24}$/;

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export async function handleTiktokCommand(
  interaction: ChatInputCommandInteraction,
) {
  if (!interaction.inGuild()) return;

  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "setchannel") {
    const channel = interaction.options.getChannel("channel", true);

    await GuildSettings.findOneAndUpdate(
      { guildId },
      { alertChannelId: channel.id },
      { upsert: true },
    );

    await interaction.reply({
      content: `LIVE alerts will post in <#${channel.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---- add: this section changed ----
  if (subcommand === "add") {
    const settings = await GuildSettings.findOne({ guildId });
    if (!settings) {
      await interaction.reply({
        content: "Set an alert channel first with `/tiktok setchannel`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const username = normalizeUsername(
      interaction.options.getString("username", true),
    );
    if (!USERNAME_PATTERN.test(username)) {
      await interaction.reply({
        content: `\`${username}\` doesn't look like a valid TikTok username.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.options.getRole("role", true);

    // TikTok lookup can take a few seconds, and Discord needs a response within 3
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await TrackedCreator.create({
        guildId,
        tiktokUsername: username,
        roleId: role.id,
      });
    } catch (error) {
      // 11000 is MongoDB's duplicate key error, from the unique index
      if (error instanceof mongo.MongoServerError && error.code === 11000) {
        await interaction.editReply(
          `@${username} is already being tracked here.`,
        );
        return;
      }
      throw error;
    }

    const nickname = await lookupCreator(username).catch(() => null);
    const profileUrl = `https://www.tiktok.com/@${username}`;

    const content = nickname
      ? `Now tracking **${nickname}** (@${username}). Alerts will ping <@&${role.id}>.`
      : `Now tracking @${username}. Alerts will ping <@&${role.id}>.\n` +
        `I couldn't confirm this account right now (they may just be offline). Check the spelling: <${profileUrl}>`;

    await interaction.editReply({ content, allowedMentions: { parse: [] } });
    return;
  }
  // ---- end of changed section ----

  if (subcommand === "remove") {
    const username = normalizeUsername(
      interaction.options.getString("username", true),
    );
    const result = await TrackedCreator.deleteOne({
      guildId,
      tiktokUsername: username,
    });

    await interaction.reply({
      content:
        result.deletedCount > 0
          ? `Stopped tracking @${username}.`
          : `@${username} wasn't being tracked here.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "list") {
    const settings = await GuildSettings.findOne({ guildId });
    const creators = await TrackedCreator.find({ guildId }).sort({
      tiktokUsername: 1,
    });

    const channelLine = settings
      ? `Alert channel: <#${settings.alertChannelId}>`
      : "Alert channel: not set";

    const creatorLines = creators.length
      ? creators.map(c => `• @${c.tiktokUsername} → <@&${c.roleId}>`).join("\n")
      : "No creators tracked yet.";

    await interaction.reply({
      content: `${channelLine}\n\n${creatorLines}`,
      flags: MessageFlags.Ephemeral,
      // Shows role names without actually pinging anyone
      allowedMentions: { parse: [] },
    });
  }
}
