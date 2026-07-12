import type { TrackRequest } from "@nightqueue/protocol";
import type { SearchResult } from "./types";

export const CONFIDENCE_THRESHOLD = 0.5;

const WEIGHT = {
  isrc: 0.7, // ISRC equality outweighs every other signal combined
  title: 0.3,
  artist: 0.25,
  durationGraceMs: 5000, // duration gaps under this are free
  durationPenaltyPerSec: 0.03, // charged per second beyond the grace window
  durationPenaltyMax: 0.4,
  markerPenalty: 0.35, // per variant marker the candidate adds and the request lacks
};

const MARKERS =
  /\b(cover|covered|sped ?up|slowed|remix|nightcore|8d|live|acoustic|instrumental|karaoke|reverb)\b/g;

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b.*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeArtist(s: string): string {
  return normalize(s).replace(/\btopic\b/g, "").replace(/\s+/g, " ").trim();
}

function markers(s: string): Set<string> {
  return new Set(s.toLowerCase().match(MARKERS) ?? []);
}

export function scoreCandidate(request: TrackRequest, candidate: SearchResult): number {
  let score = 0;

  if (request.isrc && candidate.isrc && request.isrc.toUpperCase() === candidate.isrc.toUpperCase())
    score += WEIGHT.isrc;

  if (request.title && normalize(request.title) === normalize(candidate.title))
    score += WEIGHT.title;

  const reqArtists = (request.artists ?? []).map(normalizeArtist).filter(Boolean);
  const candArtist = normalizeArtist(candidate.author);
  if (candArtist && reqArtists.some((a) => candArtist.includes(a) || a.includes(candArtist)))
    score += WEIGHT.artist;

  if (request.durationMs != null) {
    const overSec =
      Math.max(0, Math.abs(request.durationMs - candidate.durationMs) - WEIGHT.durationGraceMs) / 1000;
    score -= Math.min(overSec * WEIGHT.durationPenaltyPerSec, WEIGHT.durationPenaltyMax);
  }

  const reqMarkers = markers(request.title ?? "");
  for (const m of markers(candidate.title)) if (!reqMarkers.has(m)) score -= WEIGHT.markerPenalty;

  return Math.max(0, Math.min(1, score));
}
