// Unit tests for the duplicate finder. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { findDuplicates } from "../src/features/duplicates";
import type { Track } from "../src/spotify/types";

let n = 0;
const t = (name: string, artist: string, uri?: string, durationMs = 200_000): Track => ({
  uri: uri ?? `spotify:track:${++n}`, uid: `uid${++n}`, name, artists: [artist], album: "", durationMs,
  addedAt: "", explicit: false, playable: true, local: false, imageUrl: "",
});

test("exact duplicates: later copies are suggested", () => {
  const groups = findDuplicates([t("Обійми", "Океан Ельзи", "u:1"), t("Other", "X"), t("Обійми", "Океан Ельзи", "u:1")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.kind, "exact");
  assert.deepEqual(groups[0]!.entries.map((e) => [e.position, e.suggested]), [[1, false], [3, true]]);
});

test("remaster of the same length is suggested, live is not", () => {
  const groups = findDuplicates([
    t("Heroes", "David Bowie"),
    t("Heroes - 2017 Remaster", "David Bowie"),
    t("Yesterday", "The Beatles"),
    t("Yesterday (Live at the BBC)", "The Beatles"),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]!.entries.map((e) => e.suggested), [false, true]);
  assert.deepEqual(groups[1]!.entries.map((e) => e.suggested), [false, false]);
  assert.deepEqual(groups[1]!.entries[1]!.tags, ["live"]);
});

test("remaster with a different length is shown but not suggested", () => {
  const groups = findDuplicates([t("Song", "A", undefined, 200_000), t("Song (Remastered)", "A", undefined, 260_000)]);
  assert.deepEqual(groups[0]!.entries.map((e) => e.suggested), [false, false]);
});

test("feat. and case do not matter; different artists are different songs", () => {
  const groups = findDuplicates([
    t("Stay (feat. Justin Bieber)", "The Kid LAROI"),
    t("STAY", "The Kid LAROI"),
    t("Stay", "Rihanna"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.entries.length, 2);
});

test("a version word in the bare title is not a version", () => {
  const groups = findDuplicates([t("Live Forever", "Oasis"), t("Forever", "Oasis")]);
  assert.equal(groups.length, 0);
});

test("remix and sped-up versions are grouped but never suggested", () => {
  const groups = findDuplicates([t("Track", "A"), t("Track - Sped Up", "A"), t("Track (X Remix)", "A")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.entries.filter((e) => e.suggested).length, 0);
});

test("cyrillic titles with punctuation match", () => {
  const groups = findDuplicates([t("Не твоя війна", "Океан Ельзи"), t("Не твоя війна!", "Океан Ельзи")]);
  assert.equal(groups.length, 1);
});
