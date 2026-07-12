import { LoadType } from "shoukaku";
import type { Shoukaku } from "shoukaku";
import type { Resolver } from "@nightqueue/protocol";
import type { ResolverDeps } from "@nightqueue/resolver";
import { trackFromLavalink, trackFromResolved, type QueueTrack } from "./queue";

const DIRECT_HOST = /(youtube\.com|youtu\.be|soundcloud\.com)/i;

export interface ResolveContext {
  shoukaku: Shoukaku;
  resolver: Resolver;
  resolverDeps: ResolverDeps;
}

export function toSpotifyUri(input: string): string | null {
  if (/^spotify:(track|album|playlist|artist):[A-Za-z0-9]+$/.test(input)) return input;
  const match = input.match(/open\.spotify\.com\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  return match ? `spotify:${match[1]}:${match[2]}` : null;
}

export async function resolveSpotifyUri(
  ctx: ResolveContext,
  uri: string,
  requestedBy: string,
): Promise<QueueTrack[]> {
  const requests = await ctx.resolverDeps.loadSpotify(uri);
  const tracks: QueueTrack[] = [];
  for (const request of requests) {
    const resolved = await ctx.resolver.resolve(request);
    if (resolved) tracks.push(trackFromResolved(resolved, request, requestedBy));
  }
  return tracks;
}

export async function resolvePlay(
  ctx: ResolveContext,
  query: string,
  requestedBy: string,
): Promise<{ tracks: QueueTrack[]; error?: string }> {
  const spotify = toSpotifyUri(query);
  if (spotify) {
    const tracks = await resolveSpotifyUri(ctx, spotify, requestedBy);
    return tracks.length ? { tracks } : { tracks: [], error: "Could not resolve that Spotify link." };
  }

  if (/^https?:\/\//i.test(query) && DIRECT_HOST.test(query)) {
    const node = ctx.shoukaku.getIdealNode();
    if (!node) return { tracks: [], error: "Audio node unavailable." };
    const res = await node.rest.resolve(query);
    if (res?.loadType === LoadType.TRACK) return { tracks: [trackFromLavalink(res.data, requestedBy)] };
    if (res?.loadType === LoadType.PLAYLIST)
      return { tracks: res.data.tracks.map((track) => trackFromLavalink(track, requestedBy)) };
    return { tracks: [], error: "Nothing playable at that URL." };
  }

  const results = await ctx.resolver.search(query, 1);
  const best = results[0];
  if (!best) return { tracks: [], error: "No results found." };
  return { tracks: [trackFromResolved(best, { source: "search", title: query }, requestedBy)] };
}
