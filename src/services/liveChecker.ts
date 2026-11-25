import type { Client } from "discord.js";
import {
  TikTokLiveConnection,
  fetchRoomInfoFromApiLiveRoute,
  fetchRoomInfoFromHtmlRoute,
} from "tiktok-live-connector";
import { config } from "../config.js";
import { TrackedCreator } from "../model/TrackedCreator.js";
import { renderAlertImage, sendLiveAlert, sendModeUpdate } from "./notifier.js";
import type { LiveDetails } from "../types.js";

// Same shape from both the TikTok API and the /live web page
interface LivePageInfo {
  user?: {
    roomId?: string;
    nickname?: string;
    avatarMedium?: string;
    avatarThumb?: string;
  };
  liveRoom?: {
    status?: number;
    title?: string;
    coverUrl?: string;
    liveSubOnly?: number;
  };
}

// TikTok's room details, which are hidden for 18+ LIVEs
interface RoomInfoResponse {
  status_code: number;
  data: {
    title?: string;
    cover?: { url_list?: string[] };
    age_restricted?: { restricted?: boolean };
  };
}

// TikTok's response when a LIVE is 18+ and its details are hidden
const AGE_RESTRICTED_CODE = 4003110;

// TikTok's room status once a LIVE has ended
const LIVE_ENDED_STATUS = 4;

// Small gap between creators so TikTok doesn't see a burst of requests
const PAUSE_BETWEEN_CREATORS_MS = 1_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function createConnection(username: string) {
  return new TikTokLiveConnection(username, {
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
}

// API first, web page as backup; null means neither could be read
async function readLiveInfo(
  connection: TikTokLiveConnection,
  username: string,
): Promise<LivePageInfo | null> {
  try {
    const response = await fetchRoomInfoFromApiLiveRoute({
      webClient: connection.webClient,
      uniqueId: username,
    });
    if (response.data) return response.data as LivePageInfo;
  } catch {
    // Fall through to the web page
  }

  try {
    // The package's type says this is wrapped, but it returns the inner object (see probe output)
    return (await fetchRoomInfoFromHtmlRoute({
      webClient: connection.webClient,
      uniqueId: username,
    })) as unknown as LivePageInfo;
  } catch {
    return null;
  }
}

function toLiveDetails(
  info: LivePageInfo,
  username: string,
): LiveDetails | null {
  const roomId = info.user?.roomId;
  const status = info.liveRoom?.status;

  if (!roomId || status === undefined || status === LIVE_ENDED_STATUS)
    return null;

  return {
    roomId,
    title: info.liveRoom?.title || "LIVE now",
    coverUrl: info.liveRoom?.coverUrl || null,
    nickname: info.user?.nickname || username,
    avatarUrl: info.user?.avatarMedium || info.user?.avatarThumb || null,
    isAgeRestricted: false,
    isSubOnly: (info.liveRoom?.liveSubOnly ?? 0) > 0,
  };
}

// Only called once per new stream, to find the 18+ flag and fill in title/cover
async function addRoomDetails(
  connection: TikTokLiveConnection,
  username: string,
  live: LiveDetails,
): Promise<LiveDetails> {
  const response = (await connection.fetchRoomInfo(
    live.roomId,
  )) as unknown as RoomInfoResponse;

  if (response.status_code === AGE_RESTRICTED_CODE) {
    return { ...live, isAgeRestricted: true };
  }

  if (response.status_code !== 0) {
    console.warn(
      `Room details unavailable for @${username} (TikTok code ${response.status_code})`,
    );
    return live;
  }

  const { data } = response;

  return {
    ...live,
    title: data.title || live.title,
    coverUrl: data.cover?.url_list?.[0] ?? live.coverUrl,
    isAgeRestricted: data.age_restricted?.restricted === true,
  };
}

async function markOffline(username: string) {
  await TrackedCreator.updateMany(
    { tiktokUsername: username, isLive: true },
    { $set: { isLive: false } },
  );
}

// Super Fan only can be switched on or off mid-stream; every check already reports it
async function announceModeChanges(
  client: Client,
  username: string,
  current: LiveDetails,
) {
  const changeFilter = {
    tiktokUsername: username,
    lastRoomId: current.roomId,
    "lastLive.isSubOnly": !current.isSubOnly,
  };

  const changed = await TrackedCreator.find(changeFilter);

  for (const creator of changed) {
    // Claim the change before posting, same as new alerts, so it's announced once
    const claim = await TrackedCreator.updateOne(
      { ...changeFilter, _id: creator._id },
      { $set: { "lastLive.isSubOnly": current.isSubOnly } },
    );
    if (claim.modifiedCount === 0 || !creator.lastLive) continue;

    // Keep the announced title/cover/18+ and only flip the Super Fan setting
    const updated: LiveDetails = {
      ...creator.lastLive,
      isSubOnly: current.isSubOnly,
    };

    try {
      await sendModeUpdate(client, creator, updated);
    } catch (error) {
      console.error(
        `Mode update failed for @${username} in server ${creator.guildId}:`,
        error,
      );
    }
  }
}

// Returns false when TikTok couldn't be read, so the cycle can spot a full block
async function checkCreator(
  client: Client,
  username: string,
): Promise<boolean> {
  const connection = createConnection(username);
  const info = await readLiveInfo(connection, username);

  if (!info) {
    // Offline creators often have no readable live data
    await markOffline(username);
    return false;
  }

  const basic = toLiveDetails(info, username);

  if (!basic) {
    await markOffline(username);
    return true;
  }

  await announceModeChanges(client, username, basic);

  // Every server tracking this creator that hasn't been alerted for this stream yet
  const pending = await TrackedCreator.find({
    tiktokUsername: username,
    lastRoomId: { $ne: basic.roomId },
  });

  // Already announced everywhere, so skip the extra TikTok request
  if (pending.length === 0) return true;

  const live = await addRoomDetails(connection, username, basic);

  // Frame the picture once, even if several servers get this alert
  const framedImage = await renderAlertImage(live);

  for (const creator of pending) {
    // Claim the alert before sending so a restart or overlap can never double-ping
    const claim = await TrackedCreator.updateOne(
      { _id: creator._id, lastRoomId: { $ne: live.roomId } },
      {
        $set: {
          isLive: true,
          lastRoomId: live.roomId,
          lastLive: live,
          alertChannelId: null,
          alertMessageId: null,
        },
      },
    );
    if (claim.modifiedCount === 0) continue;

    try {
      const sent = await sendLiveAlert(client, creator, live, framedImage);
      if (sent) {
        await TrackedCreator.updateOne(
          { _id: creator._id },
          {
            $set: {
              alertChannelId: sent.channelId,
              alertMessageId: sent.messageId,
            },
          },
        );
      }
    } catch (error) {
      console.error(
        `Alert failed for @${username} in server ${creator.guildId}:`,
        error,
      );
    }
  }

  return true;
}

async function checkAllCreators(client: Client) {
  // distinct = each username once, even if both servers track them
  const usernames: string[] = await TrackedCreator.distinct("tiktokUsername");
  let pagesRead = 0;

  for (const username of usernames) {
    try {
      if (await checkCreator(client, username)) pagesRead++;
    } catch (error) {
      console.error(`Check failed for @${username}:`, error);
    }
    await sleep(PAUSE_BETWEEN_CREATORS_MS);
  }

  // One unreadable creator is normal (offline); all of them failing means something's wrong
  if (usernames.length > 1 && pagesRead === 0) {
    console.warn(
      "No TikTok data could be read this cycle. TikTok may be blocking the bot, or the session cookie expired.",
    );
  }
}

export function startLiveChecker(client: Client) {
  const runCycle = async () => {
    try {
      await checkAllCreators(client);
    } catch (error) {
      console.error("Live check cycle failed:", error);
    } finally {
      // Schedule the next run only after this one finishes, so cycles never overlap
      setTimeout(runCycle, config.checkIntervalMs);
    }
  };

  void runCycle();
}

// Used by /tiktok add to confirm the account and show its display name
export async function lookupCreator(username: string): Promise<string | null> {
  const connection = createConnection(username);
  const info = await readLiveInfo(connection, username);
  return info?.user?.nickname ?? null;
}
