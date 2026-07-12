import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  PUBLIC_BASE_URL: z
    .url()
    .default("http://localhost:3000")
    .transform((url) => url.replace(/\/+$/, "")),
  LAVALINK_HOST: z.string().default("lavalink"),
  LAVALINK_PORT: z.coerce.number().int().positive().default(2333),
  LAVALINK_PASSWORD: z.string().default("youshallnotpass"),
  PORT: z.coerce.number().int().positive().default(3000),
  COMMAND_PREFIX: z.string().default("nq!"),
  GUILD_WHITELIST: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((id) => id.trim()).filter(Boolean)),
  DATA_DIR: z.string().default("./data"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
