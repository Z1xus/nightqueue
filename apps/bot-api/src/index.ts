import pino from "pino";
import { createResolver } from "@nightqueue/resolver";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { createStore } from "./store";
import { createShoukaku } from "./lavalink";
import { createResolverDeps } from "./resolver-deps";
import { QueueManager } from "./queue";
import { createClient, wireClient } from "./discord/client";
import { createServer } from "./api/server";
import type { AppContext } from "./context";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

  const db = openDb(config);
  const store = createStore(db);
  const client = createClient();
  const shoukaku = createShoukaku(client, config);
  const resolverDeps = createResolverDeps(shoukaku, db);
  const resolver = createResolver(resolverDeps);
  const queue = new QueueManager({ shoukaku, db, resolver, client, logger });

  const ctx: AppContext = {
    queue,
    resolver,
    resolverDeps,
    shoukaku,
    store,
    logger,
    allowedGuilds: config.GUILD_WHITELIST,
    prefix: config.COMMAND_PREFIX,
    db,
    client,
    config,
  };

  wireClient(client, shoukaku, ctx, logger, () => queue.restore());

  const server = createServer(ctx);
  await server.listen({ port: config.PORT, host: "0.0.0.0" });
  await client.login(config.DISCORD_TOKEN);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    queue.persistAll();
    await server.close().catch(() => {});
    client.destroy();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
