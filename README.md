# discord-channel-merger

TypeScript Node.js script to replay messages from one Discord channel into another channel, including attachments and key metadata.

## What it can preserve

- Message order (oldest to newest)
- Visible author identity per replayed message (username + avatar via webhook)
- Attachments (re-uploaded)
- Embeds (where compatible)
- Original metadata in message body (author ID, message ID, creation/edit timestamp)

## What Discord does not allow preserving exactly

- Original `message.id`
- Original message timestamp shown by Discord UI
- Exact "real author" attribution (messages are sent by webhook)
- Some object types (system messages, components, reactions, pins) as true native objects

This script keeps those details in the replayed text metadata block so data is not lost.

## Setup

1. Create a Discord bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **Bot** in the left sidebar.
3. Enable these bot intents:
   - `Server Members Intent` (optional)
   - `Message Content Intent` (required)
4. Invite the bot to your server (see detailed steps in the next section).
5. Copy `.env.example` to `.env` and fill values.

## Invite bot to server

1. Open your app in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Go to **OAuth2 > URL Generator**.
3. Under **Scopes**, select:
   - `bot`
4. Under **Bot Permissions**, select:
   - `Read Message History`
   - `View Channels`
   - `Send Messages`
   - `Manage Webhooks`
   - `Attach Files`
   - `Embed Links`
5. Copy the generated URL at the bottom, open it in your browser, and choose your server.
6. Click **Authorize** and complete the captcha if prompted.
7. In Discord, confirm the bot appears in your server member list.

If your channels use per-channel overrides, make sure the bot role also has those permissions in both source and destination channels.

## Getting the required input values

### `DISCORD_BOT_TOKEN`

1. Open your app in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Go to **Bot**.
3. Under **Token**, click **Reset Token** (or **Copy** if already generated).
4. Paste it into `.env` as `DISCORD_BOT_TOKEN`.

### `SOURCE_CHANNEL_ID` and `DEST_CHANNEL_ID`

1. In Discord, go to **User Settings > Advanced**.
2. Enable **Developer Mode**.
3. Right-click the source channel, then click **Copy Channel ID**.
4. Right-click the destination channel, then click **Copy Channel ID**.
5. Paste those into `.env` as `SOURCE_CHANNEL_ID` and `DEST_CHANNEL_ID`.

### Optional values

- `WEBHOOK_NAME`: any name you want for the destination webhook (script creates/reuses it).
- `FETCH_BATCH_SIZE`: keep at `100` unless you need smaller fetch batches.
- `REQUEST_DELAY_MS`: increase if you hit rate limits.
- `ATTACHMENT_CONCURRENCY`: lower this if attachment-heavy channels trigger rate limits.
- `DRY_RUN`: start with `true`, switch to `false` for real migration.

## Install

```bash
npm install
```

## Run

Dry run first:

```bash
npm run start
```

When output looks good, set `DRY_RUN=false` in `.env` and run again.

## Config

- `DISCORD_BOT_TOKEN`: bot token
- `SOURCE_CHANNEL_ID`: source channel ID
- `DEST_CHANNEL_ID`: destination channel ID
- `WEBHOOK_NAME`: webhook name to create/use in destination channel
- `FETCH_BATCH_SIZE`: messages per fetch request (max 100)
- `REQUEST_DELAY_MS`: delay between API calls
- `ATTACHMENT_CONCURRENCY`: parallel attachment downloads per message
- `DRY_RUN`: `true` logs only, `false` performs replay

## Build and type-check

```bash
npm run check
npm run build
```
