import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { tiktokCommand } from "../commands/tiktok.js";

async function deploy() {
  const rest = new REST().setToken(config.discordToken);

  await rest.put(Routes.applicationCommands(config.clientId), {
    body: [tiktokCommand.toJSON()],
  });

  console.log("Slash commands registered");
}

deploy().catch(error => {
  console.error("Failed to register commands:", error);
  process.exit(1);
});
