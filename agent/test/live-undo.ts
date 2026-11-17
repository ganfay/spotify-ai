// Live test, run inside the Spotify client (see build.mjs --test).
// Creates ONE throw-away playlist, damages it in three ways, undoes each one,
// and deletes the playlist at the end. No other playlist is touched.

import { restoreSnapshot, takeSnapshot, deleteSnapshot } from "../src/snapshots";
import * as spotify from "../src/spotify/adapter";

const NAME = "spotify-ai test (safe to delete)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(): Promise<unknown> {
  const results: Record<string, unknown>[] = [];
  const liked = (await spotify.getLikedTracks()).slice(0, 12).map((t) => t.uri);
  // 12 songs + two duplicates, so the playlist has repeated entries.
  const initial = [...liked, liked[0]!, liked[5]!];
  const playlist = await spotify.createPlaylist(NAME);
  const snapshotIds: string[] = [];
  try {
    await spotify.addTracks(playlist, initial);
    await sleep(800);
    const original = (await spotify.getTracks(playlist)).map((t) => t.uri);
    results.push({ step: "setup", ok: original.join() === initial.join(), count: original.length });

    const scenario = async (name: string, damage: () => Promise<void>) => {
      const snap = await takeSnapshot(playlist, NAME, name);
      snapshotIds.push(snap.id);
      await damage();
      const damaged = (await spotify.getTracks(playlist)).map((t) => t.uri);
      const res = await restoreSnapshot(snap);
      const after = (await spotify.getTracks(playlist)).map((t) => t.uri);
      results.push({
        step: name,
        ok: after.join() === original.join() && res.exact,
        wasDamaged: damaged.join() !== original.join(),
        ...res,
      });
    };

    await scenario("undo after removing 5 entries (incl. one duplicate copy)", async () => {
      const t = await spotify.getTracks(playlist);
      await spotify.removeEntries(playlist, [t[1]!, t[4]!, t[7]!, t[12]!, t[13]!]);
    });
    await scenario("undo after reordering (reverse the playlist)", async () => {
      const t = await spotify.getTracks(playlist);
      for (const entry of t) await spotify.moveEntries(playlist, [entry], "start");
    });
    await scenario("undo after a shuffle-like reorder", async () => {
      const t = await spotify.getTracks(playlist);
      for (const i of [9, 2, 13, 5]) await spotify.moveEntries(playlist, [t[i]!], "start");
    });
    await scenario("undo after adding 3 foreign tracks and removing 2", async () => {
      const t = await spotify.getTracks(playlist);
      const foreign = (await spotify.getLikedTracks()).slice(20, 23).map((x) => x.uri);
      await spotify.addTracks(playlist, foreign, "start");
      await spotify.removeEntries(playlist, [t[2]!, t[9]!]);
    });
  } finally {
    snapshotIds.forEach(deleteSnapshot);
    await spotify.deletePlaylist(playlist).then(
      () => results.push({ step: "cleanup", ok: true }),
      (e) => results.push({ step: "cleanup", ok: false, error: String(e) }),
    );
  }
  return results;
}
