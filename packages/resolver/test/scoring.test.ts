import { expect, test } from "bun:test";
import type { TrackRequest } from "@nightqueue/protocol";
import { CONFIDENCE_THRESHOLD, scoreCandidate } from "../src/index";
import type { SearchResult } from "../src/index";

const request: TrackRequest = {
  source: "spotify",
  sourceId: "abc",
  title: "Blinding Lights",
  artists: ["The Weeknd"],
  album: "After Hours",
  durationMs: 200000,
  isrc: "USUG11904206",
};

function candidate(over: Partial<SearchResult>): SearchResult {
  return {
    encoded: "enc",
    identifier: "id",
    source: "youtube",
    title: "Blinding Lights",
    author: "The Weeknd",
    durationMs: 200000,
    uri: "https://youtu.be/x",
    ...over,
  };
}

test("exact match scores above the confidence threshold", () => {
  expect(scoreCandidate(request, candidate({}))).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
});

test("cover version is penalized below the original and threshold", () => {
  const original = scoreCandidate(request, candidate({}));
  const cover = scoreCandidate(request, candidate({ title: "Blinding Lights (Cover)" }));
  expect(cover).toBeLessThan(original);
  expect(cover).toBeLessThan(CONFIDENCE_THRESHOLD);
});

test("live version is penalized below the original and threshold", () => {
  const original = scoreCandidate(request, candidate({}));
  const live = scoreCandidate(request, candidate({ title: "Blinding Lights (Live)" }));
  expect(live).toBeLessThan(original);
  expect(live).toBeLessThan(CONFIDENCE_THRESHOLD);
});

test("duration mismatch lowers the score", () => {
  const close = scoreCandidate(request, candidate({}));
  const far = scoreCandidate(request, candidate({ durationMs: 260000 }));
  expect(far).toBeLessThan(close);
});

test("isrc match dominates a fuzzier title", () => {
  const isrcMatch = scoreCandidate(
    request,
    candidate({ title: "The Weeknd - Blinding Lights (Official Video)", isrc: "USUG11904206" }),
  );
  const exactTitleNoIsrc = scoreCandidate(request, candidate({ isrc: undefined }));
  expect(isrcMatch).toBeGreaterThan(exactTitleNoIsrc);
  expect(isrcMatch).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
});
