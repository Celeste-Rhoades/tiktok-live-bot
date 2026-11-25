import {
  TikTokLiveConnection,
  fetchRoomInfoFromApiLiveRoute,
} from "tiktok-live-connector";
import { config } from "../config.js";

const POLL_MS = 20_000;

// Skip fields that change constantly (counts, times, links) so real setting changes stand out
const NOISY_KEYS =
  /count|stats|time|url|uri|now|log_id|sign|expire|stream|token|avatar|cover|ticket|rank|fans|score|digg|watch|enter/i;

function flatten(value: unknown, prefix: string, out: Record<string, string>) {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (NOISY_KEYS.test(key)) continue;
      flatten(child, `${prefix}.${key}`, out);
    }
  } else {
    out[prefix] = JSON.stringify(value);
  }
  return out;
}

async function snapshot(connection: TikTokLiveConnection, username: string) {
  const fields: Record<string, string> = {};

  try {
    const api = await fetchRoomInfoFromApiLiveRoute({
      webClient: connection.webClient,
      uniqueId: username,
    });
    flatten(api.data?.liveRoom, "quickCheck", fields);
  } catch {
    fields["quickCheck"] = "FAILED";
  }

  try {
    const roomId = await connection.fetchRoomId();
    flatten(await connection.fetchRoomInfo(roomId), "roomDetails", fields);
  } catch {
    fields["roomDetails"] = "FAILED";
  }

  return fields;
}

async function watch(username: string) {
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

  let previous = await snapshot(connection, username);
  console.log(
    `Watching @${username} (${Object.keys(previous).length} fields). Ctrl + C to stop.`,
  );

  setInterval(async () => {
    const current = await snapshot(connection, username);
    const time = new Date().toLocaleTimeString();
    const changed = Object.keys({ ...previous, ...current }).filter(
      path => previous[path] !== current[path],
    );

    if (changed.length === 0) {
      console.log(`${time}  no changes`);
    } else {
      for (const path of changed) {
        console.log(`${time}  ${path}: ${previous[path]} -> ${current[path]}`);
      }
    }
    previous = current;
  }, POLL_MS);
}

const username = process.argv[2];
if (!username) {
  console.error("Usage: npm run watch-modes -- <tiktok username>");
  process.exit(1);
}

watch(username).catch(error => {
  console.error("Watch failed:", error);
  process.exit(1);
});
