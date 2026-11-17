import {
  TikTokLiveConnection,
  fetchRoomInfoFromHtmlRoute,
  fetchRoomInfoFromApiLiveRoute,
} from "tiktok-live-connector";
import { config } from "../config.js";

async function tryStep(label: string, step: () => Promise<unknown>) {
  try {
    const result = await step();
    console.log(`\n${label}: OK`);
    console.dir(result, { depth: 2 });
  } catch (error) {
    console.log(`\n${label}: FAILED`);
    console.log(error instanceof Error ? error.message : error);
  }
}

async function probe(username: string) {
  const connection = new TikTokLiveConnection(username, {
    session: {
      cookie: {
        type: "cookie",
        value: {
          sessionId: config.tiktokSessionId,
          ttTargetIdc: config.tiktokTargetIdc,
        },
      },
    },
  });

  await tryStep("1. Web page", () =>
    fetchRoomInfoFromHtmlRoute({
      webClient: connection.webClient,
      uniqueId: username,
    }),
  );

  await tryStep("2. TikTok API", () =>
    fetchRoomInfoFromApiLiveRoute({
      webClient: connection.webClient,
      uniqueId: username,
    }),
  );

  await tryStep("3. fetchIsLive (all sources)", () => connection.fetchIsLive());
}

const username = process.argv[2];

if (!username) {
  console.error("Usage: npm run probe -- <tiktok username>");
  process.exit(1);
}

probe(username).catch(error => {
  console.error("Probe failed:", error);
  process.exit(1);
});
