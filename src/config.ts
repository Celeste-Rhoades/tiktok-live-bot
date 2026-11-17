import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  mongoUri: required("MONGODB_URI"),
  tiktokSessionId: required("TIKTOK_SESSION_ID"),
  tiktokTargetIdc: required("TIKTOK_TT_TARGET_IDC"),

  // Two minutes balances fast alerts against TikTok rate limits
  checkIntervalMs: 120_000,
};
