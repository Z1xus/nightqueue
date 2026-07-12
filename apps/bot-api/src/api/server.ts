import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Constants } from "shoukaku";
import type { AppContext } from "../context";
import { registerPairing } from "./pairing";
import { registerEnqueue } from "./enqueue";
import { tokenBucket } from "./ratelimit";

export function createServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  app.register(cors, { origin: true });

  const pairLimit = tokenBucket(20, 1);
  const enqueueLimit = tokenBucket(30, 2);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/pair") && !pairLimit(request.ip))
      return reply.code(429).send({ code: "rate_limited", message: "Too many requests." });
    if (request.url.startsWith("/enqueue")) {
      const key = request.headers.authorization ?? request.ip;
      if (!enqueueLimit(key))
        return reply.code(429).send({ code: "rate_limited", message: "Too many requests." });
    }
  });

  app.get("/healthz", async (_request, reply) => {
    const node = ctx.shoukaku.getIdealNode();
    const lavalinkOk = node?.state === Constants.State.CONNECTED;
    let dbOk = true;
    try {
      ctx.db.query("SELECT 1").get();
    } catch {
      dbOk = false;
    }
    const status = lavalinkOk && dbOk ? 200 : 503;
    return reply.code(status).send({
      status: status === 200 ? "ok" : "degraded",
      lavalink: node ? Constants.State[node.state] : "none",
      db: dbOk ? "ok" : "error",
    });
  });

  registerPairing(app, ctx);
  registerEnqueue(app, ctx);
  return app;
}
