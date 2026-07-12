import type { Client } from "discord.js";
import type { Config } from "./config";
import type { Db } from "./db";
import type { BotContext } from "./discord/commands";

export interface AppContext extends BotContext {
  db: Db;
  client: Client;
  config: Config;
}
