import type { PlayableSource, ResolvedTrack, TrackRequest } from "@nightqueue/protocol";

export type SearchPrefix = "ytsearch" | "ytmsearch" | "scsearch";

export type SearchResult = {
  encoded: string;
  identifier: string;
  source: PlayableSource;
  title: string;
  author: string;
  durationMs: number;
  isrc?: string;
  uri: string;
};

export type CacheStore = {
  get(key: string): ResolvedTrack | null;
  set(key: string, track: ResolvedTrack): void;
  delete(key: string): void;
};

export type ResolverDeps = {
  search(query: string, prefix: SearchPrefix): Promise<SearchResult[]>;
  loadSpotify(uri: string): Promise<TrackRequest[]>;
  cache: CacheStore;
};
