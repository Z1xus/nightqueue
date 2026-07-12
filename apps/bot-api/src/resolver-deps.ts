import { LoadType } from "shoukaku";
import type { Shoukaku, Track } from "shoukaku";
import type { ResolverDeps, SearchResult, CacheStore } from "@nightqueue/resolver";
import type { ResolvedTrack, TrackRequest } from "@nightqueue/protocol";
import type { Db } from "./db";

const toSearchResult = (track: Track): SearchResult => ({
  encoded: track.encoded,
  identifier: track.info.identifier,
  source: track.info.sourceName === "soundcloud" ? "soundcloud" : "youtube",
  title: track.info.title,
  author: track.info.author,
  durationMs: track.info.length,
  isrc: track.info.isrc,
  uri: track.info.uri ?? "",
});

const toTrackRequest = (track: Track): TrackRequest => ({
  source: "spotify",
  sourceId: track.info.identifier,
  url: track.info.uri,
  title: track.info.title,
  artists: [track.info.author],
  durationMs: track.info.length,
  isrc: track.info.isrc,
});

function cacheStore(db: Db): CacheStore {
  return {
    get(key: string): ResolvedTrack | null {
      const row = db
        .query<{ resolved_json: string }, { $k: string }>(
          `SELECT resolved_json FROM resolution_cache WHERE cache_key = $k`,
        )
        .get({ $k: key });
      return row ? (JSON.parse(row.resolved_json) as ResolvedTrack) : null;
    },
    set(key: string, track: ResolvedTrack): void {
      db.query(
        `INSERT INTO resolution_cache (cache_key, resolved_json, created_at)
         VALUES ($k, $v, $t)
         ON CONFLICT(cache_key) DO UPDATE SET resolved_json = $v, created_at = $t`,
      ).run({ $k: key, $v: JSON.stringify(track), $t: new Date().toISOString() });
    },
    delete(key: string): void {
      db.query(`DELETE FROM resolution_cache WHERE cache_key = $k`).run({ $k: key });
    },
  };
}

export function createResolverDeps(shoukaku: Shoukaku, db: Db): ResolverDeps {
  const load = async (identifier: string) => {
    const node = shoukaku.getIdealNode();
    if (!node) throw new Error("no_lavalink_node");
    return node.rest.resolve(identifier);
  };

  return {
    async search(query, prefix) {
      const res = await load(`${prefix}:${query}`);
      if (res?.loadType === LoadType.SEARCH) return res.data.map(toSearchResult);
      return [];
    },
    async loadSpotify(uri) {
      const res = await load(uri.replace(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/, "https://open.spotify.com/$1/$2"));
      if (res?.loadType === LoadType.TRACK) return [toTrackRequest(res.data)];
      if (res?.loadType === LoadType.PLAYLIST) return res.data.tracks.map(toTrackRequest);
      return [];
    },
    cache: cacheStore(db),
  };
}
