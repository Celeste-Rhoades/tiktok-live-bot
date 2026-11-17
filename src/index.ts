import mongoose from "mongoose";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { config } from "./config.js";
import { handleTiktokCommand } from "./commands/tiktok.js";
import { startLiveChecker } from "./services/liveChecker.js";

const client = new Client({
  // Guilds is the only intent needed for slash commands and sending messages
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  startLiveChecker(readyClient);
});

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log("Connected to MongoDB");

  await client.login(config.discordToken);
}

main().catch(error => {
  console.error("Startup failed:", error);
  process.exit(1);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "tiktok") return;

  try {
    await handleTiktokCommand(interaction);
  } catch (error) {
    console.error("Command failed:", error);

    // Admin still gets feedback instead of "application did not respond"
    const message = {
      content: "Something went wrong. Try again.",
      flags: MessageFlags.Ephemeral,
    } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message);
    } else {
      await interaction.reply(message);
    }
  }
});
