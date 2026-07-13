import { Client, Events, GatewayIntentBits } from "discord.js";
import { Constants } from "shoukaku";
import type { Shoukaku } from "shoukaku";
import type { Logger } from "pino";
import { buildCommands, handleInteraction, handleMessage, type BotContext } from "./commands";

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

export function wireClient(
  client: Client,
  shoukaku: Shoukaku,
  ctx: BotContext,
  logger: Logger,
  restore: () => Promise<void>,
): void {
  shoukaku.on("ready", (name, resumed) => logger.info({ node: name, resumed }, "lavalink ready"));
  shoukaku.on("error", (name, error) => logger.error({ node: name, err: error.message }, "lavalink error"));
  shoukaku.on("close", (name, code) => logger.warn({ node: name, code }, "lavalink closed"));
  shoukaku.on("disconnect", (name, count) => logger.warn({ node: name, count }, "lavalink disconnect"));
  shoukaku.on("reconnecting", (name, left) => logger.info({ node: name, left }, "lavalink reconnecting"));

  client.once(Events.ClientReady, async (ready) => {
    await ready.application.commands.set(buildCommands().map((command) => command.toJSON()));
    logger.info({ user: ready.user.tag }, "discord ready");
    await restore().catch((err) => logger.error({ err: String(err) }, "queue restore failed"));
  });

  client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
    if (newState.id !== newState.client.user.id || newState.channelId) return;
    const connection = shoukaku.connections.get(newState.guild.id);
    if (connection?.state === Constants.State.DISCONNECTED)
      void ctx.queue.onExternalDisconnect(newState.guild.id);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleMessage(ctx, message);
    } catch (err) {
      logger.error({ err: String(err) }, "message command failed");
      await message.reply("Something went wrong.").catch(() => {});
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      await handleInteraction(ctx, interaction);
    } catch (err) {
      logger.error({ command: interaction.commandName, err: String(err) }, "command failed");
      const message = { content: "Something went wrong.", flags: 64 as const };
      if (interaction.deferred || interaction.replied) await interaction.editReply(message.content).catch(() => {});
      else await interaction.reply(message).catch(() => {});
    }
  });
}
