// Snapshots and undo (decision 8): before the agent changes a playlist it saves
// the playlist's entries; undo puts the playlist back into that exact order.

import * as spotify from "./spotify/adapter";
import type { EntryRef } from "./spotify/types";

const STORAGE_KEY = "spotify-ai:snapshots";
const MAX_SNAPSHOTS = 30;

export interface Snapshot {
  id: string;
  playlistUri: string;
  playlistName: string;
  /** Why the snapshot was taken, shown to the user ("Remove 12 duplicates"). */
  reason: string;
  createdAt: string;
  entries: EntryRef[];
}

export interface RestoreResult {
  removed: number;
  reAdded: number;
  reordered: boolean;
  /** True when the playlist now has the same songs in the same order as the snapshot. */
  exact: boolean;
}

function load(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Snapshot[];
  } catch {
    return [];
  }
}

function store(all: Snapshot[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_SNAPSHOTS)));
}

export function listSnapshots(playlistUri?: string): Snapshot[] {
  const all = load();
  return (playlistUri ? all.filter((s) => s.playlistUri === playlistUri) : all).reverse();
}

export function deleteSnapshot(id: string): void {
  store(load().filter((s) => s.id !== id));
}

/** Saves the current content of a playlist. Call this before every change. */
export async function takeSnapshot(playlistUri: string, playlistName: string, reason: string): Promise<Snapshot> {
  const tracks = await spotify.getTracks(playlistUri);
  const snapshot: Snapshot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playlistUri,
    playlistName,
    reason,
    createdAt: new Date().toISOString(),
    entries: tracks.map(({ uri, uid }) => ({ uri, uid })),
  };
  store([...load(), snapshot]);
  return snapshot;
}

/**
 * Puts the playlist back to the snapshot.
 *
 * 1. Entries that did not exist in the snapshot are removed.
 * 2. Entries that survived are put back into snapshot order. Spotify keeps the
 *    relative order of entries moved together, so each misplaced entry is
 *    moved on its own; entries that are already in order are left alone.
 * 3. Entries that are missing are inserted at their old places (they get a
 *    new "date added" — Spotify does not let us set it).
 */
export async function restoreSnapshot(snapshot: Snapshot): Promise<RestoreResult> {
  const { playlistUri, entries } = snapshot;
  const wanted = new Set(entries.map((e) => e.uid));

  let current = await spotify.getTracks(playlistUri);
  const extra = current.filter((t) => !wanted.has(t.uid));
  if (extra.length > 0) {
    await spotify.removeEntries(playlistUri, extra);
    current = current.filter((t) => wanted.has(t.uid));
  }

  // --- 2. order of the survivors
  const present = new Set(current.map((t) => t.uid));
  const survivors = entries.filter((e) => present.has(e.uid));
  const targetIndex = new Map(survivors.map((e, i) => [e.uid, i]));
  const inPlace = longestIncreasingRun(current.map((t) => targetIndex.get(t.uid)!));
  let moved = 0;
  for (let i = 0; i < survivors.length; i++) {
    const entry = survivors[i]!;
    if (inPlace.has(i)) continue;
    const previous = survivors[i - 1];
    await spotify.moveEntries(playlistUri, [entry], previous ? { after: previous } : "start");
    moved++;
  }

  // --- 3. missing entries, inserted in runs before the next survivor
  const missing = entries.filter((e) => !present.has(e.uid));
  for (let i = 0; i < entries.length; ) {
    if (present.has(entries[i]!.uid)) {
      i++;
      continue;
    }
    let end = i;
    while (end < entries.length && !present.has(entries[end]!.uid)) end++;
    const run = entries.slice(i, end).map((e) => e.uri);
    const next = entries[end];
    await spotify.addTracks(playlistUri, run, next ? { before: next } : "end");
    i = end;
  }

  current = await spotify.getTracks(playlistUri);
  const exact = current.length === entries.length && current.every((t, i) => t.uri === entries[i]!.uri);
  return { removed: extra.length, reAdded: missing.length, reordered: moved > 0, exact };
}

/** Indices (values) that form the longest increasing subsequence of `values`. */
function longestIncreasingRun(values: number[]): Set<number> {
  const tails: number[] = []; // tails[k] = position in `values` of the smallest tail of a run of length k+1
  const previous: number[] = new Array(values.length).fill(-1);
  values.forEach((value, pos) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[pos] = tails[lo - 1]!;
    tails[lo] = pos;
  });
  const keep = new Set<number>();
  for (let pos = tails[tails.length - 1] ?? -1; pos !== -1; pos = previous[pos]!) keep.add(values[pos]!);
  return keep;
}

export interface RestorePreview {
  /** Entries in the playlist now that did not exist at the snapshot: undo removes them. */
  willRemove: number;
  /** Snapshot entries that are gone now: undo adds them back. */
  willAdd: number;
  /** True when the playlist already equals the snapshot. */
  nothingToDo: boolean;
}

/** What an undo would do, without doing it. */
export async function previewRestore(snapshot: Snapshot): Promise<RestorePreview> {
  const current = await spotify.getTracks(snapshot.playlistUri);
  const wanted = new Set(snapshot.entries.map((e) => e.uid));
  const present = new Set(current.map((t) => t.uid));
  const willRemove = current.filter((t) => !wanted.has(t.uid)).length;
  const willAdd = snapshot.entries.filter((e) => !present.has(e.uid)).length;
  const sameOrder = current.length === snapshot.entries.length && current.every((t, i) => t.uid === snapshot.entries[i]!.uid);
  return { willRemove, willAdd, nothingToDo: willRemove === 0 && willAdd === 0 && sameOrder };
}

/**
 * Undo that can itself be undone: the playlist's current state is saved as a
 * new undo point before anything is restored.
 */
export async function safeRestore(snapshot: Snapshot, backupReason: string): Promise<RestoreResult> {
  await takeSnapshot(snapshot.playlistUri, snapshot.playlistName, backupReason);
  return restoreSnapshot(snapshot);
}
