import { Shoukaku, Connectors } from "shoukaku";
import type { Client } from "discord.js";
import type { LavalinkResponse, Node } from "shoukaku";
import type { Config } from "./config";

const RESUME_TIMEOUT_S = 60;

export function createShoukaku(client: Client, config: Config): Shoukaku {
  return new Shoukaku(
    new Connectors.DiscordJS(client),
    [
      {
        name: "main",
        url: `${config.LAVALINK_HOST}:${config.LAVALINK_PORT}`,
        auth: config.LAVALINK_PASSWORD,
      },
    ],
    { resume: true, resumeTimeout: RESUME_TIMEOUT_S, reconnectTries: Infinity, moveOnDisconnect: false },
  );
}

export function idealNode(shoukaku: Shoukaku): Node | undefined {
  return shoukaku.getIdealNode();
}

export function loadTracks(node: Node, identifier: string): Promise<LavalinkResponse | undefined> {
  return node.rest.resolve(identifier);
}
