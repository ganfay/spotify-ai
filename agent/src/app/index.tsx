// The agent's page. Phase 2: playlist picker + the duplicates feature.
// Rule everywhere: show first, change only after the user's click (decision 8).

import { type DuplicateGroup, findDuplicates } from "../features/duplicates";
import { restoreSnapshot, type Snapshot, takeSnapshot } from "../snapshots";
import * as spotify from "../spotify/adapter";
import type { EntryRef, Playlist, Track } from "../spotify/types";

import { AgentView } from "./agent";
import { SettingsView } from "./settings";
import { BackLink, css, duration, GlobalStyles, hooks, Icon, Spinner } from "./ui";

declare const Spicetify: any;

type Done =
  | { type: "copy"; uri: string; name: string; kept: number; removed: number }
  | { type: "removed"; snapshot: Snapshot; removed: number }
  | { type: "undone"; exact: boolean };

function Duplicates({ playlist, onBack }: { playlist: Playlist; onBack: () => void }) {
  const { useEffect, useState } = hooks();
  const [tracks, setTracks] = useState(null as Track[] | null);
  const [groups, setGroups] = useState([] as DuplicateGroup[]);
  const [picked, setPicked] = useState(new Set<string>());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(null as Done | null);

  const scan = async () => {
    setError("");
    setDone(null);
    setTracks(null);
    try {
      const all = await spotify.getTracks(playlist.uri);
      const found = findDuplicates(all);
      setTracks(all);
      setGroups(found);
      setPicked(new Set(found.flatMap((g) => g.entries.filter((e) => e.suggested).map((e) => e.track.uid))));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void scan();
  }, [playlist.uri]);

  const toggle = (uid: string) => {
    const next = new Set(picked);
    if (!next.delete(uid)) next.add(uid);
    setPicked(next);
    setConfirming(false);
  };
  const run = async (label: string, job: () => Promise<Done>, rescan = false) => {
    setBusy(label);
    setError("");
    try {
      const result = await job();
      if (rescan) await scan();
      setDone(result);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
    setConfirming(false);
  };

  const makeCopy = () =>
    run("Creating the cleaned copy…", async () => {
      const keep = tracks!.filter((t) => !picked.has(t.uid) && !t.local).map((t) => t.uri);
      const name = `${playlist.name} (no duplicates)`;
      const uri = await spotify.createPlaylist(name);
      await spotify.addTracks(uri, keep);
      return { type: "copy", uri, name, kept: keep.length, removed: picked.size };
    });
  const removeHere = () =>
    run("Removing…", async () => {
      const entries: EntryRef[] = tracks!.filter((t) => picked.has(t.uid)).map(({ uri, uid }) => ({ uri, uid }));
      const snapshot = await takeSnapshot(playlist.uri, playlist.name, `Remove ${entries.length} duplicates`);
      await spotify.removeEntries(playlist.uri, entries);
      return { type: "removed", snapshot, removed: entries.length };
    }, true);
  const undo = (snapshot: Snapshot) =>
    run("Undoing…", async () => ({ type: "undone", exact: (await restoreSnapshot(snapshot)).exact }), true);

  return (
    <div>
      <BackLink label="All playlists" onClick={onBack} />
      <h2 style={{ fontSize: 20, margin: "6px 0" }}>Duplicates in “{playlist.name}”</h2>
      {error && <p style={css.error}>{error}</p>}
      {!tracks && !error && <p style={{ ...css.muted, display: "flex", gap: 8, alignItems: "center" }}><Spinner size={14} />Reading the playlist</p>}

      {done?.type === "copy" && (
        <div style={css.notice}>
          Created “{done.name}” with {done.kept} tracks ({done.removed} left out). The original playlist was not changed.{" "}
          <a style={{ textDecoration: "underline", cursor: "pointer" }}
             onClick={() => Spicetify.Platform.History.push(`/playlist/${done.uri.split(":")[2]}`)}>Open it</a>
        </div>
      )}
      {done?.type === "removed" && (
        <div style={css.notice}>
          Removed {done.removed} tracks.{" "}
          <button style={css.secondary} disabled={!!busy} onClick={() => undo(done.snapshot)}>Undo</button>
          <div style={css.muted}>Tracks brought back by undo get today’s “date added”.</div>
        </div>
      )}
      {done?.type === "undone" && (
        <div style={css.notice}>{done.exact ? "Undone. The playlist is back to how it was." : "Undo finished, but the playlist does not match the saved state exactly — please check it."}</div>
      )}

      {tracks && groups.length === 0 && <p>No duplicates found in {tracks.length} tracks.</p>}
      {tracks && groups.length > 0 && (
        <div>
          <p style={css.muted}>
            {groups.length} groups in {tracks.length} tracks. Ticked = will be removed. Exact repeats are ticked for you;
            different versions (live, remix, …) are only shown.
          </p>
          {groups.map((group) => (
            <div key={group.entries[0]!.track.uid} style={css.group}>
              <div style={css.muted}>{group.kind === "exact" ? "Same track twice" : "Different versions of one song"}</div>
              {group.entries.map(({ track, position, tags }) => (
                <label key={track.uid} style={css.entry}>
                  <input type="checkbox" checked={picked.has(track.uid)} onChange={() => toggle(track.uid)} />
                  <span style={{ flex: 1 }}>
                    {track.name}
                    {tags.map((tag) => <span key={tag} style={css.tag}>{tag}</span>)}
                    <div style={css.muted}>{track.artists.join(", ")} · {track.album}</div>
                  </span>
                  <span style={css.muted}>#{position} · {duration(track.durationMs)}</span>
                </label>
              ))}
            </div>
          ))}

          <div style={css.bar}>
            <button style={css.primary} disabled={!!busy || picked.size === 0} onClick={makeCopy}>
              Create a cleaned copy ({picked.size} left out)
            </button>
            {playlist.editable && !confirming && (
              <button style={css.secondary} disabled={!!busy || picked.size === 0} onClick={() => setConfirming(true)}>
                Remove from this playlist…
              </button>
            )}
            {confirming && (
              <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12 }}>
                <span style={{ marginRight: 16 }}>Remove {picked.size} tracks from “{playlist.name}”?</span>
                <button style={{ ...css.danger, marginRight: 12 }} disabled={!!busy} onClick={removeHere}>Yes, remove</button>
                <button style={css.secondary} onClick={() => setConfirming(false)}>Cancel</button>
              </span>
            )}
            {busy && <span style={css.muted}>{busy}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

interface Feature {
  id: string;
  title: string;
  text: string;
  ready: boolean;
}
const FEATURES: Feature[] = [
  { id: "duplicates", title: "Find duplicates", text: "Exact repeats and different versions of one song.", ready: true },
  { id: "agent", title: "AI agent", text: "Tell it in your own words what to do with a playlist.", ready: true },
  { id: "language", title: "Filter by language", text: "For example: everything except Russian, into a new playlist.", ready: false },
  { id: "split", title: "Split a big playlist", text: "Into smaller ones by mood, genre or energy.", ready: false },
  { id: "cleanup", title: "Clean up", text: "Tracks that do not fit, each with a reason.", ready: false },
  { id: "recommend", title: "Recommendations", text: "New songs based on a playlist, with a reason for each.", ready: false },
];

function Home({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div style={css.cards}>
      {FEATURES.map((f) => (
        <div key={f.id} className={f.ready ? "sai-card ready" : "sai-card"} style={{ ...css.card, cursor: f.ready ? "pointer" : "default", opacity: f.ready ? 1 : 0.55 }}
             onClick={() => f.ready && onOpen(f.id)}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
            {f.title}{!f.ready && <span style={css.badge}>soon</span>}
          </div>
          <div style={css.muted}>{f.text}</div>
        </div>
      ))}
    </div>
  );
}

function PlaylistPicker({ title, onPick, onBack }: { title: string; onPick: (p: Playlist) => void; onBack: () => void }) {
  const { useEffect, useState } = hooks();
  const [playlists, setPlaylists] = useState(null as Playlist[] | null);
  const [error, setError] = useState("");
  useEffect(() => {
    spotify.listPlaylists().then(setPlaylists, (e: Error) => setError(e.message));
  }, []);
  return (
    <div>
      <div style={{ marginTop: 20 }}><BackLink label="All tools" onClick={onBack} /></div>
      <h2 style={{ fontSize: 20, margin: "6px 0 12px" }}>{title} — pick a playlist</h2>
      {error && <p style={css.error}>{error}</p>}
      {!playlists && !error && <p style={css.muted}>Loading…</p>}
      {playlists?.map((p: Playlist) => (
        <div key={p.uri} style={css.row} onClick={() => onPick(p)}>
          <span>{p.name}{!p.editable && <span style={css.muted}> · not yours (a copy can still be made)</span>}</span>
          <span style={css.muted}>{p.trackCount} tracks</span>
        </div>
      ))}
    </div>
  );
}

function App() {
  const { useState } = hooks();
  const [tool, setTool] = useState("" as string);
  const [selected, setSelected] = useState(null as Playlist | null);

  let body;
  if (tool === "duplicates" && selected) {
    body = <div style={{ marginTop: 20 }}><Duplicates playlist={selected} onBack={() => setSelected(null)} /></div>;
  } else if (tool === "duplicates") {
    body = <PlaylistPicker title="Find duplicates" onPick={setSelected} onBack={() => setTool("")} />;
  } else if (tool === "agent") {
    body = <AgentView onBack={() => setTool("")} onSettings={() => setTool("settings")} />;
  } else if (tool === "settings") {
    body = <SettingsView onBack={() => setTool("")} />;
  } else {
    body = (
      <div>
        <Home onOpen={setTool} />
        <div style={{ marginTop: 28 }}><span className="sai-link" onClick={() => setTool("settings")}><Icon name="settings" size={16} />Settings — AI access and API key</span></div>
      </div>
    );
  }
  return (
    <section style={css.page}>
      <GlobalStyles />
      <h1 style={{ marginBottom: 4 }}>AI Playlists</h1>
      <p style={css.muted}>Nothing in your library changes until you confirm it.</p>
      {body}
    </section>
  );
}

export function render() {
  return <App />;
}
