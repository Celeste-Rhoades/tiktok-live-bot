# TikTok LIVE Alerts

A Discord bot that pings a role when a tracked TikTok creator goes LIVE, including 18+ and Super Fan LIVEs that most notification bots miss.

## Why I built it

Our servers used Notify Me for TikTok alerts, but it never fired when a creator's LIVE was marked 18+. Those streams are hidden from anyone who isn't logged in as a verified adult, and most bots check while logged out. This bot checks with an authenticated 18+ session, so it sees every LIVE.

## Features

- Alerts for regular, 18+, and Super Fan (subscriber-only) LIVEs, each labeled and color-coded
- One alert per stream, even across restarts
- Works across multiple Discord servers, each with its own channel, creators, and roles
- Admin-only slash commands
- Confirms the creator's display name when they're added, and warns about likely typos

## Commands

All commands require the **Manage Server** permission.

| Command                                    | What it does                                                    |
| ------------------------------------------ | --------------------------------------------------------------- |
| `/tiktok setchannel channel:#live`         | Sets the channel where alerts post                              |
| `/tiktok add username:@creator role:@Role` | Starts tracking a creator and pings that role when they go LIVE |
| `/tiktok remove username:@creator`         | Stops tracking a creator                                        |
| `/tiktok list`                             | Shows the alert channel and tracked creators                    |

## How it works

Every 2 minutes the bot:

1. Gets each **unique** tracked username from MongoDB. If two servers track the same creator, TikTok is only checked once.
2. Checks whether each creator is live using TikTok's API, with their LIVE page as a backup.
3. Compares the stream's room ID to the last one alerted for each server.
4. For new streams only, fetches stream details once (title, cover, 18+ flag), then sends the alert.

### Design decisions

- **Notify once:** each stream has a unique room ID. The bot saves it _before_ sending (an atomic `updateOne` that only matches if the room ID is new), so a crash or overlapping run can never double-ping.
- **Database before API:** if every server has already been alerted for a stream, the bot skips the details request entirely. While a creator stays live, each cycle costs one request.
- **No overlapping cycles:** the loop uses `setTimeout` after each run finishes instead of `setInterval`.
- **18+ handling:** TikTok hides the title and cover of 18+ LIVEs even from adult sessions. The bot detects this (`status_code 4003110`), labels the alert 18+, and uses the creator's profile picture instead.
- **Failure isolation:** one bad username or one broken server doesn't stop the rest of the cycle. If every creator fails at once, the bot logs a warning that TikTok may be blocking it or the session expired.

## Tech stack

- TypeScript (strict), Node.js, ES modules
- discord.js v14
- MongoDB Atlas with Mongoose
- [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector)
- Hosted on Railway

## Setup

1. Clone the repo and install packages:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` from the Discord Developer Portal
   - `MONGODB_URI` from MongoDB Atlas
   - `TIKTOK_SESSION_ID` and `TIKTOK_TT_TARGET_IDC` cookies from a logged-in, age-verified TikTok account
3. Register the slash commands (once, and again whenever they change):
   ```
   npm run deploy-commands
   ```
4. Run it:
   ```
   npm run dev
   ```

### Deploying

The bot runs on Railway as a background service with no public URL. Railway builds with `npm run build` and starts with `npm start`. Pushing to `main` redeploys automatically.

## Notes

- This uses TikTok's unofficial endpoints, so it can break if TikTok changes them.
- Use a spare TikTok account for the session cookie, not a personal one. Automated traffic can get an account flagged.
- If alerts stop, the session cookie has likely expired. Grab a fresh `sessionid` and update it in the environment variables.
