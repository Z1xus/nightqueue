import { z } from "zod";

export const TrackSource = z.enum(["spotify", "youtube", "soundcloud", "search"]);

export const TrackRequest = z.object({
  source: TrackSource,
  sourceId: z.string().optional(),
  url: z.url().optional(),
  title: z.string().optional(),
  artists: z.array(z.string()).optional(),
  album: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  isrc: z.string().optional(),
});

export const PlayableSource = z.enum(["youtube", "soundcloud"]);

export const ResolvedTrack = z.object({
  encoded: z.string(),
  identifier: z.string(),
  source: PlayableSource,
  confidence: z.number().min(0).max(1),
  metadata: z.object({
    title: z.string(),
    artists: z.array(z.string()),
    durationMs: z.number().int().nonnegative(),
    url: z.url().optional(),
    isrc: z.string().optional(),
  }),
});

export const HealthStatus = z.object({
  healthy: z.boolean(),
  detail: z.string().optional(),
});

export type TrackSource = z.infer<typeof TrackSource>;
export type TrackRequest = z.infer<typeof TrackRequest>;
export type PlayableSource = z.infer<typeof PlayableSource>;
export type ResolvedTrack = z.infer<typeof ResolvedTrack>;
export type HealthStatus = z.infer<typeof HealthStatus>;

export interface ProviderAdapter {
  readonly source: PlayableSource;
  resolve(request: TrackRequest): Promise<ResolvedTrack | null>;
  search(query: string, limit?: number): Promise<ResolvedTrack[]>;
  healthCheck(): Promise<HealthStatus>;
}

export interface Resolver {
  resolve(request: TrackRequest): Promise<ResolvedTrack | null>;
  search(query: string, limit?: number): Promise<ResolvedTrack[]>;
  invalidate(request: TrackRequest): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}
