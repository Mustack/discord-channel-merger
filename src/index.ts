import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { setTimeout as sleep } from "node:timers/promises";
import {
  AttachmentBuilder,
  ChannelType,
  Client,
  Collection,
  GatewayIntentBits,
  Message,
  NewsChannel,
  TextChannel,
  Webhook,
} from "discord.js";
import dotenv from "dotenv";
import pLimit from "p-limit";

dotenv.config();

type MigratableChannel = TextChannel | NewsChannel;

const REQUIRED_ENV = ["DISCORD_BOT_TOKEN", "SOURCE_CHANNEL_ID", "DEST_CHANNEL_ID"] as const;

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID;
const DEST_CHANNEL_ID = process.env.DEST_CHANNEL_ID;
const WEBHOOK_NAME = process.env.WEBHOOK_NAME ?? "Channel Merger";
const FETCH_BATCH_SIZE = toNumber(process.env.FETCH_BATCH_SIZE, 100);
const REQUEST_DELAY_MS = toNumber(process.env.REQUEST_DELAY_MS, 125);
const ATTACHMENT_CONCURRENCY = toNumber(process.env.ATTACHMENT_CONCURRENCY, 3);
const DRY_RUN = process.env.DRY_RUN === "true";

void main();

async function main(): Promise<void> {
  assertRequiredEnv();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    console.log("Logged in.");

    const sourceChannel = await getMigratableChannel(client, SOURCE_CHANNEL_ID!);
    const destChannel = await getMigratableChannel(client, DEST_CHANNEL_ID!);
    const webhook = await getOrCreateWebhook(destChannel, WEBHOOK_NAME);
    const messages = await fetchAllMessages(sourceChannel);

    console.log(`Loaded ${messages.length} source messages.`);
    if (messages.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    for (const [index, message] of messages.entries()) {
      if (DRY_RUN) {
        logDryRunMessage(index, messages.length, message);
        continue;
      }

      await replayMessage(webhook, message);
      console.log(`[${index + 1}/${messages.length}] Replayed ${message.id}`);
      await sleep(REQUEST_DELAY_MS);
    }

    console.log(
      DRY_RUN
        ? "Dry run complete. No messages were written."
        : "Migration complete.",
    );
  } finally {
    client.destroy();
  }
}

function toNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

async function getMigratableChannel(client: Client, channelId: string): Promise<MigratableChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} not found.`);
  }

  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    throw new Error(
      `Channel ${channelId} is not a text-like channel. Found type=${channel.type}.`,
    );
  }

  return channel;
}

async function getOrCreateWebhook(
  channel: MigratableChannel,
  name: string,
): Promise<Webhook> {
  const existing = (await channel.fetchWebhooks()).find((hook) => hook.name === name);
  if (existing) return existing;
  return channel.createWebhook({ name });
}

async function fetchAllMessages(channel: MigratableChannel): Promise<Message[]> {
  const all: Message[] = [];
  let before: string | undefined;

  while (true) {
    const options = before
      ? { limit: FETCH_BATCH_SIZE, before }
      : { limit: FETCH_BATCH_SIZE };
    const batch: Collection<string, Message<true>> = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    const batchMessages = [...batch.values()];
    all.push(...batchMessages);
    before = batchMessages[batchMessages.length - 1]?.id;
    console.log(`Fetched ${all.length} messages so far...`);

    if (batch.size < FETCH_BATCH_SIZE) break;
    await sleep(REQUEST_DELAY_MS);
  }

  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function buildReplayText(message: Message): string {
  const parts: string[] = [];

  if (message.content) {
    parts.push(message.content);
  }

  if (message.reference?.messageId) {
    parts.push(`\n↪ reply to message ${message.reference.messageId}`);
  }

  parts.push(
    `\n\n[original metadata]`,
    `author: ${message.author.tag} (${message.author.id})`,
    `message_id: ${message.id}`,
    `created_at: ${new Date(message.createdTimestamp).toISOString()}`,
  );

  if (message.editedTimestamp) {
    parts.push(`edited_at: ${new Date(message.editedTimestamp).toISOString()}`);
  }

  if (message.attachments.size > 0) {
    parts.push(
      `attachments: ${[...message.attachments.values()].map((a) => a.url).join(", ")}`,
    );
  }

  return parts.join("\n").slice(0, 2000);
}

async function replayMessage(webhook: Webhook, message: Message): Promise<void> {
  const limit = pLimit(ATTACHMENT_CONCURRENCY);
  const attachmentTasks = [...message.attachments.values()].map((attachment) =>
    limit(async () => buildAttachment(attachment.url, attachment.name ?? "file")),
  );
  const files = (await Promise.allSettled(attachmentTasks))
    .filter((result): result is PromiseFulfilledResult<AttachmentBuilder> => result.status === "fulfilled")
    .map((result) => result.value);

  const embeds = message.embeds.map((embed) => embed.toJSON());

  await webhook.send({
    username: `${message.author.username} (migrated)`,
    avatarURL: message.author.displayAvatarURL({ extension: "png" }),
    content: buildReplayText(message),
    embeds,
    files,
    allowedMentions: { parse: [] },
  });
}

async function buildAttachment(url: string, originalName: string): Promise<AttachmentBuilder> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const safeName = sanitizeFilename(originalName, url);
  return new AttachmentBuilder(buffer, { name: safeName });
}

function sanitizeFilename(original: string, url: string): string {
  const normalized = original.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (normalized.length > 0 && normalized.length <= 100) {
    return normalized;
  }

  const digest = createHash("sha1").update(url).digest("hex").slice(0, 12);
  return `attachment_${digest}.bin`;
}

function logDryRunMessage(index: number, total: number, message: Message): void {
  console.log(
    `[DRY RUN ${index + 1}/${total}] ${message.author.tag}: ${new Date(
      message.createdTimestamp,
    ).toISOString()} - ${message.content.slice(0, 80)}`,
  );
}
