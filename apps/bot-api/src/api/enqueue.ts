import type { FastifyInstance, FastifyReply } from "fastify";
import type { Client } from "discord.js";
import { EnqueueRequest, EnqueueResponse, type ApiError } from "@nightqueue/protocol";
import type { AppContext } from "../context";
import type { EnqueueMode } from "../queue";
import { resolveSpotifyUri } from "../resolve-input";

const MODE: Record<EnqueueRequest["action"], EnqueueMode> = {
  enqueue: "append",
  play: "now",
  playNext: "next",
};

const fail = (reply: FastifyReply, status: number, error: ApiError) => reply.code(status).send(error);

function findUserVoice(client: Client, userId: string): { guildId: string; voiceChannelId: string } | null {
  for (const [guildId, guild] of client.guilds.cache) {
    const channelId = guild.voiceStates.cache.get(userId)?.channelId;
    if (channelId) return { guildId, voiceChannelId: channelId };
  }
  return null;
}

export function registerEnqueue(app: FastifyInstance, ctx: AppContext): void {
  app.post("/enqueue", async (request, reply) => {
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    const discordUserId = token && ctx.store.resolveToken(token);
    if (!discordUserId) return fail(reply, 401, { code: "unauthorized", message: "Invalid device token." });

    const parsed = EnqueueRequest.safeParse(request.body);
    if (!parsed.success)
      return fail(reply, 400, { code: "bad_request", message: "Invalid enqueue request." });
    const body = parsed.data;

    const cached = ctx.store.getIdempotent(body.requestId);
    if (cached) return reply.send(JSON.parse(cached));

    const target =
      body.target === "automatic" ? findUserVoice(ctx.client, discordUserId) : body.target;
    if (!target)
      return fail(reply, 409, { code: "conflict", message: "You are not in a voice channel." });
    if (ctx.allowedGuilds.length && !ctx.allowedGuilds.includes(target.guildId))
      return fail(reply, 403, { code: "forbidden", message: "This server is not whitelisted." });

    const tracks = (
      await Promise.all(body.uris.map((uri) => resolveSpotifyUri(ctx, uri, discordUserId)))
    ).flat();
    if (!tracks.length)
      return fail(reply, 502, { code: "resolver_failed", message: "Could not resolve any tracks." });

    await ctx.queue.enqueue(target.guildId, target.voiceChannelId, null, tracks, MODE[body.action]);

    const response: EnqueueResponse = {
      requestId: body.requestId,
      accepted: tracks.length,
      target,
    };
    ctx.store.saveIdempotent(body.requestId, JSON.stringify(response));
    ctx.logger.info({ requestId: body.requestId, accepted: tracks.length }, "enqueue accepted");
    return reply.send(response);
  });
}
