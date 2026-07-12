import type { HealthStatus, ResolvedTrack, Resolver, TrackRequest } from "@nightqueue/protocol";
import type { ResolverDeps, SearchPrefix, SearchResult } from "./types";
import { CONFIDENCE_THRESHOLD, normalize, scoreCandidate } from "./scoring";

type Tier = { query: string; prefix: SearchPrefix };

function cacheKey(req: TrackRequest): string {
  if (req.source === "spotify" && req.sourceId) return `sp:${req.sourceId}`;
  if (req.isrc) return `isrc:${req.isrc.toUpperCase()}`;
  const artists = (req.artists ?? []).map(normalize).join(" ");
  return `q:${artists}|${normalize(req.title ?? "")}`;
}

function queryString(req: TrackRequest): string {
  return [(req.artists ?? []).join(" "), req.title, req.album].filter(Boolean).join(" ").trim();
}

function tiersFor(req: TrackRequest): Tier[] {
  if (req.source === "search") {
    const q = req.title ?? "";
    return [
      { query: q, prefix: "ytmsearch" },
      { query: q, prefix: "scsearch" },
    ];
  }
  const q = queryString(req);
  const tiers: Tier[] = [];
  if (req.isrc) tiers.push({ query: req.isrc, prefix: "ytmsearch" });
  tiers.push({ query: q, prefix: "ytmsearch" }, { query: q, prefix: "ytsearch" }, { query: q, prefix: "scsearch" });
  return tiers;
}

function toResolved(req: TrackRequest, c: SearchResult, confidence: number): ResolvedTrack {
  return {
    encoded: c.encoded,
    identifier: c.identifier,
    source: c.source,
    confidence,
    metadata: {
      title: c.title,
      artists: [c.author],
      durationMs: c.durationMs,
      url: c.uri,
      isrc: c.isrc ?? req.isrc,
    },
  };
}

export function createResolver(deps: ResolverDeps): Resolver {
  const failed = new Map<string, Set<string>>();

  async function enrich(req: TrackRequest): Promise<TrackRequest> {
    if (req.source !== "spotify") return req;
    const uri = req.url ?? (req.sourceId ? `spotify:track:${req.sourceId}` : undefined);
    if (!uri) return req;
    const [meta] = await deps.loadSpotify(uri);
    return meta ? { ...req, ...meta } : req;
  }

  async function pick(req: TrackRequest, exclude: Set<string>) {
    let best: { result: SearchResult; score: number } | null = null;
    for (const tier of tiersFor(req)) {
      for (const c of await deps.search(tier.query, tier.prefix)) {
        if (exclude.has(c.identifier)) continue;
        const score = scoreCandidate(req, c);
        if (!best || score > best.score) best = { result: c, score };
      }
      if (best && best.score >= CONFIDENCE_THRESHOLD) break;
    }
    return best;
  }

  return {
    async resolve(request) {
      const key = cacheKey(request);
      const cached = deps.cache.get(key);
      if (cached) return cached;

      const enriched = await enrich(request);
      const best = await pick(enriched, failed.get(key) ?? new Set());
      if (!best) return null;

      const resolved = toResolved(enriched, best.result, best.score);
      deps.cache.set(key, resolved);
      return resolved;
    },

    async search(query, limit = 5) {
      const req: TrackRequest = { source: "search", title: query };
      const results = await deps.search(query, "ytmsearch");
      return results
        .map((c) => toResolved(req, c, scoreCandidate(req, c)))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);
    },

    async invalidate(request) {
      const key = cacheKey(request);
      const cached = deps.cache.get(key);
      if (!cached) return;
      const set = failed.get(key) ?? new Set<string>();
      set.add(cached.identifier);
      failed.set(key, set);
      deps.cache.delete(key);
    },

    async healthCheck(): Promise<HealthStatus> {
      const probes: Array<[SearchPrefix, string]> = [
        ["ytmsearch", "youtube-music"],
        ["ytsearch", "youtube"],
        ["scsearch", "soundcloud"],
      ];
      const down: string[] = [];
      await Promise.all(
        probes.map(async ([prefix, label]) => {
          try {
            await deps.search("nightqueue health canary", prefix);
          } catch {
            down.push(label);
          }
        }),
      );
      return down.length ? { healthy: false, detail: `unreachable: ${down.join(", ")}` } : { healthy: true };
    },
  };
}
