import { z } from "zod";

export const SpotifyUri = z
  .string()
  .regex(/^spotify:(track|album|playlist|artist):[A-Za-z0-9]+$/, "invalid spotify URI");

export const EnqueueTarget = z.union([
  z.literal("automatic"),
  z.object({ guildId: z.string(), voiceChannelId: z.string() }),
]);

export const EnqueueRequest = z.object({
  action: z.enum(["enqueue", "play", "playNext"]),
  uris: z.array(SpotifyUri).min(1).max(200),
  target: EnqueueTarget.default("automatic"),
  requestId: z.uuid(),
});

export const EnqueueResponse = z.object({
  requestId: z.uuid(),
  accepted: z.number().int().nonnegative(),
  target: z.object({ guildId: z.string(), voiceChannelId: z.string() }),
});

export type SpotifyUri = z.infer<typeof SpotifyUri>;
export type EnqueueTarget = z.infer<typeof EnqueueTarget>;
export type EnqueueRequest = z.infer<typeof EnqueueRequest>;
export type EnqueueResponse = z.infer<typeof EnqueueResponse>;
