// The app's page: home with feature cards, playlist picker, duplicates.
// Rule everywhere: show first, change only after the user's click (decision 8).

import { type DuplicateGroup, findDuplicates } from "../features/duplicates";
import { loadSettings } from "../settings";
import { deleteSnapshot, listSnapshots, restoreSnapshot, type Snapshot, takeSnapshot } from "../snapshots";
import * as spotify from "../spotify/adapter";
import type { EntryRef, Playlist, Track } from "../spotify/types";

import { AgentView } from "./agent";
import { count, type Key, language, setLanguage, t } from "./i18n";
import { SettingsView } from "./settings";
import { BackLink, css, duration, GlobalStyles, hooks, Icon, Spinner, TrackRow } from "./ui";

declare const Spicetify: any;

type Done =
  | { type: "copy"; uri: string; name: string; kept: number; removed: number }
  | { type: "removed"; snapshot: Snapshot; removed: number }
  | { type: "undone"; exact: boolean };

const message = (e: unknown): string => (e as Error)?.message ?? String(e);

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
      setError(message(e));
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
      setError(message(e));
    }
    setBusy("");
    setConfirming(false);
  };

  const makeCopy = () =>
    run(t("act.creating"), async () => {
      const keep = tracks!.filter((x) => !picked.has(x.uid) && !x.local).map((x) => x.uri);
      const name = t("dup.copyName", { name: playlist.name });
      const uri = await spotify.createPlaylist(name);
      await spotify.addTracks(uri, keep);
      return { type: "copy", uri, name, kept: keep.length, removed: picked.size };
    });
  const removeHere = () =>
    run(t("act.removing"), async () => {
      const entries: EntryRef[] = tracks!.filter((x) => picked.has(x.uid)).map(({ uri, uid }) => ({ uri, uid }));
      const snapshot = await takeSnapshot(playlist.uri, playlist.name, `Remove ${entries.length} duplicates`);
      await spotify.removeEntries(playlist.uri, entries);
      return { type: "removed", snapshot, removed: entries.length };
    }, true);
  const undo = (snapshot: Snapshot) =>
    run(t("act.undoing"), async () => ({ type: "undone", exact: (await restoreSnapshot(snapshot)).exact }), true);

  return (
    <div>
      <BackLink label={t("back.playlists")} onClick={onBack} />
      <h2 style={{ fontSize: 20, margin: "6px 0" }}>{t("dup.title", { name: playlist.name })}</h2>
      {error && <p style={css.error}>{error}</p>}
      {!tracks && !error && <p style={{ ...css.muted, display: "flex", gap: 8, alignItems: "center" }}><Spinner size={14} />{t("dup.reading")}</p>}

      {done?.type === "copy" && (
        <div style={css.notice} className="sai-in">
          {t("res.copy", { name: done.name, tracks: count(done.kept, "track"), n: done.removed })}{" "}
          <a style={{ textDecoration: "underline", cursor: "pointer" }}
             onClick={() => Spicetify.Platform.History.push(`/playlist/${done.uri.split(":")[2]}`)}>{t("act.open")}</a>
        </div>
      )}
      {done?.type === "removed" && (
        <div style={css.notice} className="sai-in">
          {t("res.removed", { tracks: count(done.removed, "track") })}{" "}
          <button style={css.secondary} disabled={!!busy} onClick={() => undo(done.snapshot)}>{t("act.undo")}</button>
          <div style={css.muted}>{t("res.undoNote")}</div>
        </div>
      )}
      {done?.type === "undone" && <div style={css.notice} className="sai-in">{t(done.exact ? "res.undone" : "res.undoneInexact")}</div>}

      {tracks && groups.length === 0 && (
        <div className="sai-in" style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--spice-button, #1ed760)", color: "#000" }}>
            <Icon name="check" size={24} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{t("dup.noneTitle")}</div>
          <div style={css.muted}>{t("dup.none", { tracks: count(tracks.length, "track") })}</div>
        </div>
      )}
      {tracks && groups.length > 0 && (
        <div>
          <p style={css.muted}>{t("dup.summary", { groups: count(groups.length, "group"), tracks: count(tracks.length, "track") })}</p>
          {groups.map((group) => (
            <div key={group.entries[0]!.track.uid} style={css.group}>
              <div style={css.muted}>{t(group.kind === "exact" ? "dup.exact" : "dup.version")}</div>
              {group.entries.map(({ track, position, tags }) => (
                <TrackRow key={track.uid} uri={track.uri} name={track.name} imageUrl={track.imageUrl} local={track.local}
                          badges={tags.map((tag) => <span key={tag} style={css.tag}>{t(`tag.${tag}` as Key)}</span>)}
                          sub={`${track.artists.join(", ")} · ${track.album}`}
                          right={`#${position} · ${duration(track.durationMs)}`}
                          checked={picked.has(track.uid)} onToggle={() => toggle(track.uid)} onPlay={spotify.playTrack} />
              ))}
            </div>
          ))}

          <div style={css.bar}>
            <button style={css.primary} disabled={!!busy || picked.size === 0} onClick={makeCopy}>{t("act.cleanCopy", { n: picked.size })}</button>
            {playlist.editable && !confirming && (
              <button style={css.secondary} disabled={!!busy || picked.size === 0} onClick={() => setConfirming(true)}>{t("act.removeHere")}</button>
            )}
            {confirming && (
              <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12 }}>
                <span style={{ marginRight: 16 }}>{t("act.confirmRemove", { tracks: count(picked.size, "track"), name: playlist.name })}</span>
                <button style={{ ...css.danger, marginRight: 12 }} disabled={!!busy} onClick={removeHere}>{t("act.yesRemove")}</button>
                <button style={css.secondary} onClick={() => setConfirming(false)}>{t("act.cancel")}</button>
              </span>
            )}
            {busy && <span style={{ ...css.muted, display: "inline-flex", gap: 8, alignItems: "center" }}><Spinner size={14} />{busy}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

type FeatureId = "duplicates" | "agent" | "language" | "split" | "cleanup" | "recommend";
interface Feature {
  id: FeatureId;
  icon: "copy" | "spark" | "globe" | "split" | "funnel" | "compass";
  /** AI features start the agent with a ready-made request for the chosen playlist. */
  ai: boolean;
}
const FEATURES: Feature[] = [
  { id: "duplicates", icon: "copy", ai: false },
  { id: "agent", icon: "spark", ai: false },
  { id: "language", icon: "globe", ai: true },
  { id: "split", icon: "split", ai: true },
  { id: "cleanup", icon: "funnel", ai: true },
  { id: "recommend", icon: "compass", ai: true },
];

function Home({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div style={css.cards}>
      {FEATURES.map((f, i) => (
        <div key={f.id} className="sai-card" style={{ ...css.card, animationDelay: `${i * 55}ms` }} onClick={() => onOpen(f.id)}>
          <div className="ico"><Icon name={f.icon} size={22} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
              {t(`f.${f.id}.title` as Key)}{f.ai && <span style={css.badge}>AI</span>}
            </div>
            <div style={css.muted}>{t(`f.${f.id}.text` as Key)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Undo points of earlier changes, newest first. Shown on the home screen. */
function RecentChanges() {
  const { useState } = hooks();
  const [items, setItems] = useState(listSnapshots());
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const undo = async (snapshot: Snapshot) => {
    setBusy(snapshot.id);
    setNote("");
    try {
      const { exact } = await restoreSnapshot(snapshot);
      deleteSnapshot(snapshot.id);
      setNote(t(exact ? "res.undone" : "res.undoneInexact"));
    } catch (e) {
      setNote(message(e));
    }
    setItems(listSnapshots());
    setBusy("");
  };
  const when = (iso: string) => new Date(iso).toLocaleString(language(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ marginTop: 36 }}>
      <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>{t("home.recent")}</h2>
      {items.length === 0 ? <p style={css.muted}>{t("home.noRecent")}</p> : <p style={css.muted}>{t("home.recentHint")}</p>}
      {note && <div style={css.notice} className="sai-in">{note}</div>}
      {items.slice(0, 8).map((snapshot) => (
        <div key={snapshot.id} className="sai-trackrow" style={{ padding: "10px 12px" }}>
          <div className="sai-cover" style={{ cursor: "default" }}><Icon name="music" size={18} /></div>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 700 }}>{snapshot.playlistName}</span>
            <div style={css.muted}>{snapshot.reason} · {count(snapshot.entries.length, "track")} · {when(snapshot.createdAt)}</div>
          </span>
          <button style={{ ...css.small, display: "inline-flex", gap: 8, alignItems: "center" }} disabled={!!busy} onClick={() => undo(snapshot)}>
            {busy === snapshot.id && <Spinner size={13} />}{t("act.undo")}
          </button>
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
      <div style={{ marginTop: 20 }}><BackLink label={t("back.tools")} onClick={onBack} /></div>
      <h2 style={{ fontSize: 20, margin: "6px 0 12px" }}>{t("pick", { title })}</h2>
      {error && <p style={css.error}>{error}</p>}
      {!playlists && !error && <p style={{ ...css.muted, display: "flex", gap: 8, alignItems: "center" }}><Spinner size={14} />{t("loading")}</p>}
      {playlists?.length === 0 && <p style={css.muted}>{t("noPlaylists")}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
        {playlists?.map((p: Playlist) => (
          <div key={p.uri} className="sai-tile" onClick={() => onPick(p)} title={p.name}>
            {p.imageUrl
              ? <img className="cover" src={p.imageUrl} loading="lazy" alt="" />
              : <div className="cover"><Icon name="music" size={40} /></div>}
            <div className="name">{p.name}</div>
            <div style={css.muted}>{count(p.trackCount, "track")}{!p.editable && ` · ${t("notYours")}`}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const { useState } = hooks();
  const [tool, setTool] = useState("" as string);
  const [selected, setSelected] = useState(null as Playlist | null);
  // Re-rendering the whole page after a language change is enough: every text is read through t().
  const [lang, setLang] = useState(setLanguage(loadSettings().language));

  const feature = FEATURES.find((f) => f.id === tool);
  const home = () => {
    setTool("");
    setSelected(null);
  };
  let body;
  if (tool === "duplicates" && selected) {
    body = <div style={{ ...css.column, marginTop: 20 }}><Duplicates playlist={selected} onBack={() => setSelected(null)} /></div>;
  } else if (tool === "agent") {
    body = <AgentView onBack={home} onSettings={() => setTool("settings")} />;
  } else if (feature?.ai && selected) {
    body = <AgentView onBack={home} onSettings={() => setTool("settings")} initialPrompt={t(`p.${feature.id}` as Key, { name: selected.name })} />;
  } else if (feature && tool !== "settings") {
    body = <PlaylistPicker title={t(`f.${feature.id}.title` as Key)} onPick={setSelected} onBack={home} />;
  } else if (tool === "settings") {
    body = <SettingsView onBack={home} onLanguage={(choice) => setLang(setLanguage(choice))} />;
  } else {
    body = (
      <div>
        <Home onOpen={setTool} />
        <RecentChanges />
      </div>
    );
  }
  return (
    <section style={css.page} lang={lang}>
      <GlobalStyles />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4, cursor: "pointer" }} onClick={home}>AI Playlists</h1>
          <p style={css.muted}>{t("app.tagline")}</p>
        </div>
        {tool !== "settings" && (
          <button className="sai-pill" onClick={() => setTool("settings")}><Icon name="settings" size={17} />{t("settings.button")}</button>
        )}
      </div>
      {body}
    </section>
  );
}

export function render() {
  return <App />;
}
