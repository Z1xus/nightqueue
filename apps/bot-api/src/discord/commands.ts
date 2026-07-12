import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Message, SlashCommandOptionsOnlyBuilder } from "discord.js";
import type { Shoukaku } from "shoukaku";
import type { Logger } from "pino";
import type { Resolver } from "@nightqueue/protocol";
import type { ResolverDeps } from "@nightqueue/resolver";
import type { QueueManager } from "../queue";
import type { Store } from "../store";
import { resolvePlay } from "../resolve-input";

export interface BotContext {
  queue: QueueManager;
  resolver: Resolver;
  resolverDeps: ResolverDeps;
  shoukaku: Shoukaku;
  store: Store;
  logger: Logger;
  allowedGuilds: string[];
  prefix: string;
}

export function buildCommands(): Array<SlashCommandBuilder | SlashCommandOptionsOnlyBuilder> {
  return [
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play a track from a URL or search query")
      .addStringOption((o) => o.setName("query").setDescription("URL or search text").setRequired(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
    new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
    new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
    new SlashCommandBuilder().setName("stop").setDescription("Stop and clear the queue"),
    new SlashCommandBuilder().setName("queue").setDescription("Show the current queue"),
    new SlashCommandBuilder()
      .setName("remove")
      .setDescription("Remove a track from the queue")
      .addIntegerOption((o) => o.setName("position").setDescription("Queue position").setRequired(true).setMinValue(1)),
    new SlashCommandBuilder()
      .setName("move")
      .setDescription("Move a queued track")
      .addIntegerOption((o) => o.setName("from").setDescription("From position").setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName("to").setDescription("To position").setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName("clear").setDescription("Clear the upcoming queue"),
    new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Set playback volume")
      .addIntegerOption((o) =>
        o.setName("percent").setDescription("0-150").setRequired(true).setMinValue(0).setMaxValue(150),
      ),
    new SlashCommandBuilder().setName("disconnect").setDescription("Disconnect from voice"),
    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link a pairing code from the Spicetify extension")
      .addStringOption((o) => o.setName("code").setDescription("Pairing code").setRequired(true)),
  ];
}

const commandNames = new Set(buildCommands().map((command) => command.name));

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });

interface Invocation {
  name: string;
  args: string[];
  guildId: string | null;
  channelId: string | null;
  userId: string;
  voiceChannelId: string | null;
  defer: () => Promise<void>;
  reply: (content: string, quiet?: boolean) => Promise<void>;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function slashArgs(interaction: ChatInputCommandInteraction): string[] {
  switch (interaction.commandName) {
    case "play":
      return [interaction.options.getString("query", true)];
    case "remove":
      return [String(interaction.options.getInteger("position", true))];
    case "move":
      return [
        String(interaction.options.getInteger("from", true)),
        String(interaction.options.getInteger("to", true)),
      ];
    case "volume":
      return [String(interaction.options.getInteger("percent", true))];
    case "link":
      return [interaction.options.getString("code", true)];
    default:
      return [];
  }
}

export async function handleInteraction(
  ctx: BotContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  return runCommand(ctx, {
    name: interaction.commandName,
    args: slashArgs(interaction),
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    voiceChannelId: interaction.guild?.voiceStates.cache.get(interaction.user.id)?.channelId ?? null,
    defer: async () => void (await interaction.deferReply()),
    reply: async (content, quiet) => {
      if (interaction.deferred) await interaction.editReply(content);
      else await interaction.reply(quiet ? ephemeral(content) : { content });
    },
  });
}

export async function handleMessage(ctx: BotContext, message: Message): Promise<void> {
  if (!ctx.prefix || message.author.bot || !message.content.startsWith(ctx.prefix)) return;
  const [name = "", ...args] = message.content.slice(ctx.prefix.length).trim().split(/\s+/);
  if (!commandNames.has(name)) return;
  return runCommand(ctx, {
    name,
    args,
    guildId: message.guildId,
    channelId: message.channelId,
    userId: message.author.id,
    voiceChannelId: message.guild?.voiceStates.cache.get(message.author.id)?.channelId ?? null,
    defer: async () => {},
    reply: async (content) => void (await message.reply(content)),
  });
}

async function runCommand(ctx: BotContext, inv: Invocation): Promise<void> {
  if (inv.name === "link") return link(ctx, inv);
  const guildId = inv.guildId;
  if (!guildId) return inv.reply("Use this in a server.", true);
  if (ctx.allowedGuilds.length && !ctx.allowedGuilds.includes(guildId))
    return inv.reply("This bot is not enabled in this server.", true);
  const state = ctx.queue.get(guildId);

  switch (inv.name) {
    case "play":
      return play(ctx, inv, guildId);
    case "pause":
      if (!state?.current) return inv.reply("Nothing playing.", true);
      await ctx.queue.pause(state);
      return inv.reply("Paused.");
    case "resume":
      if (!state) return inv.reply("Nothing to resume.", true);
      await ctx.queue.resume(state);
      return inv.reply("Resumed.");
    case "skip":
      if (!state?.current) return inv.reply("Nothing to skip.", true);
      await ctx.queue.skip(state);
      return inv.reply("Skipped.");
    case "stop":
      if (!state) return inv.reply("Nothing playing.", true);
      await ctx.queue.stop(state);
      return inv.reply("Stopped.");
    case "queue":
      return inv.reply(renderQueue(state));
    case "remove": {
      if (!state) return inv.reply("Queue is empty.", true);
      const removed = ctx.queue.remove(state, Number(inv.args[0]));
      return removed ? inv.reply(`Removed **${removed.title}**.`) : inv.reply("Invalid position.", true);
    }
    case "move": {
      if (!state) return inv.reply("Queue is empty.", true);
      const moved = ctx.queue.move(state, Number(inv.args[0]), Number(inv.args[1]));
      return moved ? inv.reply("Moved.") : inv.reply("Invalid positions.", true);
    }
    case "clear":
      if (!state) return inv.reply("Queue is empty.", true);
      ctx.queue.clear(state);
      return inv.reply("Queue cleared.");
    case "volume": {
      if (!state) return inv.reply("Nothing playing.", true);
      const percent = Number(inv.args[0]);
      if (!Number.isInteger(percent) || percent < 0 || percent > 150)
        return inv.reply("Volume must be 0-150.", true);
      await ctx.queue.setVolume(state, percent);
      return inv.reply(`Volume set to ${percent}%.`);
    }
    case "disconnect":
      await ctx.queue.disconnect(guildId);
      return inv.reply("Disconnected.");
  }
}

async function play(ctx: BotContext, inv: Invocation, guildId: string): Promise<void> {
  if (!inv.voiceChannelId) return inv.reply("Join a voice channel first.", true);
  const query = inv.args.join(" ").trim();
  if (!query) return inv.reply("Give me a URL or search text.", true);
  await inv.defer();
  const { tracks, error } = await resolvePlay(ctx, query, inv.userId);
  if (!tracks.length) return inv.reply(error ?? "Nothing found.");
  await ctx.queue.enqueue(guildId, inv.voiceChannelId, inv.channelId, tracks, "append");
  const marker = tracks.some((track) => track.lowConfidence) ? " ≈ best match" : "";
  const first = tracks[0];
  const label = tracks.length === 1 && first ? `**${first.title}**` : `${tracks.length} tracks`;
  return inv.reply(`Queued ${label}${marker}`);
}

async function link(ctx: BotContext, inv: Invocation): Promise<void> {
  const code = (inv.args[0] ?? "").trim().toUpperCase();
  const session = ctx.store.getPairingByCode(code);
  if (!session || new Date(session.expires_at).getTime() < Date.now())
    return inv.reply("That pairing code is invalid or expired.", true);
  ctx.store.setPairingDiscord(session.pairing_id, inv.userId);
  ctx.logger.info({ pairingId: session.pairing_id }, "pairing linked to discord user");
  return inv.reply("Discord linked. Finish sign-in on the pairing page.", true);
}

function renderQueue(state: ReturnType<QueueManager["get"]>): string {
  if (!state?.current) return "The queue is empty.";
  const upcoming = state.queue
    .slice(0, 10)
    .map((track, index) => `${index + 1}. ${track.title} — ${formatDuration(track.durationMs)}`)
    .join("\n");
  const now = `Now playing: **${state.current.title}** — ${formatDuration(state.current.durationMs)}`;
  return upcoming ? `${now}\n\nUp next:\n${upcoming}` : now;
}
