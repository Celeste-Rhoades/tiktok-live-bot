import mongoose from "mongoose";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { handleTiktokCommand } from "./commands/tiktok.js";
import { startLiveChecker, stopLiveChecker } from "./services/liveChecker.js";
import { GuildSettings } from "./model/GuildSettings.js";
import { TrackedCreator } from "./model/TrackedCreator.js";

const client = new Client({
  // Guilds is the only intent needed for slash commands and sending messages
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  startLiveChecker(readyClient);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "tiktok") return;

  try {
    await handleTiktokCommand(interaction);
  } catch (error) {
    console.error("Command failed:", error);

    // The interaction may have expired or been answered already; never let this crash the bot
    try {
      const message = {
        content: "Something went wrong. Try again.",
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(message);
      } else {
        await interaction.reply(message);
      }
    } catch (replyError) {
      console.error("Could not send error reply:", replyError);
    }
  }
});

// Removed from a server: delete its settings and creators so they stop being checked
client.on(Events.GuildDelete, async guild => {
  try {
    await GuildSettings.deleteOne({ guildId: guild.id });
    const removed = await TrackedCreator.deleteMany({ guildId: guild.id });
    console.log(
      `Left ${guild.name}; removed ${removed.deletedCount} tracked creators`,
    );
  } catch (error) {
    console.error(`Cleanup failed for server ${guild.id}:`, error);
  }
});

// Log Discord connection problems instead of crashing
client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log("Connected to MongoDB");

  await client.login(config.discordToken);
}

// Railway sends SIGTERM on every redeploy; Ctrl + C sends SIGINT locally
async function shutdown(signal: string) {
  console.log(
    `${signal} received, finishing the current check before shutting down`,
  );
  try {
    await stopLiveChecker();
    await client.destroy();
    await mongoose.disconnect();
  } finally {
    process.exit(0);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

// Last safety net: log any missed promise error instead of taking the bot down
process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

main().catch(error => {
  console.error("Startup failed:", error);
  process.exit(1);
});
