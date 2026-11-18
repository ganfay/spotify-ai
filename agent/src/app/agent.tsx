// The AI agent's chat. The agent only proposes; every change happens in a
// ProposalCard after the user's click.

import { Agent } from "../agent/loop";
import {
  type Applied, applyAdditionsAsNew, applyAdditionsInPlace, applyNewPlaylist, applyRemovalAsCopy, applyRemovalInPlace, applySplit,
  type Proposal, type ProposedTrack, type SplitProposal, type SpotifyPort,
} from "../agent/proposals";
import { isConfigured, loadSettings } from "../settings";
import { safeRestore, type Snapshot } from "../snapshots";
import * as spotify from "../spotify/adapter";
import { getTrackData } from "../spotify/facts";
import type { Playlist, Track } from "../spotify/types";
import { count, type Key, t } from "./i18n";
import { errorText } from "./settings";
import { BackLink, css, Dots, duration, hooks, Icon, ProgressBar, Spinner, TrackRow } from "./ui";

declare const Spicetify: any;

const port: SpotifyPort = { ...spotify, getTrackData, getRecommendations: (uri) => spotify.getRecommendations(uri), searchTracks: (q) => spotify.searchTracks(q) };
// High enough that nothing is hidden in practice: a ticked row the user cannot see must not exist.
const MAX_ROWS = 3000;

const scroll = { maxHeight: 420, overflowY: "auto", margin: "8px 0", paddingRight: 6 } as const;
const turn = { display: "flex", gap: 12, margin: "18px 0 6px", alignItems: "flex-start" } as const;
const avatar = {
  width: 28, height: 28, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
  background: "var(--spice-button, #1ed760)", color: "#000",
} as const;
const mine = {
  background: "rgba(255,255,255,.1)", borderRadius: "18px 18px 4px 18px", padding: "10px 16px", maxWidth: "75%",
  marginLeft: "auto", whiteSpace: "pre-wrap", lineHeight: 1.45,
} as const;
const answer = { whiteSpace: "pre-wrap", lineHeight: 1.5, paddingTop: 3, flex: 1, minWidth: 0 } as const;
const composer = {
  display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 18px", borderRadius: 500,
  background: "var(--spice-card, #181818)", border: "1px solid rgba(255,255,255,.14)", transition: "border-color .15s",
} as const;
const composerInput = { flex: 1, minWidth: 0, background: "transparent", border: 0, color: "var(--spice-text, #fff)", fontSize: 15, padding: "8px 0" } as const;
const actions = { ...css.bar, margin: "12px 0 4px" } as const;
const confirmRow = { display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12 } as const;

function TrackRows({ tracks, onToggle }: { tracks: ProposedTrack[]; onToggle?: (uid: string) => void }) {
  return (
    <div style={scroll}>
      {tracks.slice(0, MAX_ROWS).map(({ track, reason, selected }) => (
        <TrackRow key={track.uid} uri={track.uri} name={track.name} imageUrl={track.imageUrl} local={track.local}
                  sub={<span>{track.artists.join(", ")}{reason && <span> — {reason}</span>}</span>}
                  right={track.durationMs > 0 ? duration(track.durationMs) : undefined}
                  checked={selected} onToggle={onToggle ? () => onToggle(track.uid) : undefined} onPlay={spotify.playTrack} />
      ))}
      {tracks.length > MAX_ROWS && <p style={css.muted}>{t("pr.more", { n: tracks.length - MAX_ROWS })}</p>}
    </div>
  );
}

/** "12 of 40 selected · Select all · Select none" */
function SelectBar({ tracks, onAll }: { tracks: ProposedTrack[]; onAll: (selected: boolean) => void }) {
  return (
    <div style={{ ...css.muted, display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
      <span>{t("pr.selected", { n: tracks.filter((x) => x.selected).length, total: tracks.length })}</span>
      <span className="sai-link" onClick={() => onAll(true)}>{t("pr.all")}</span>
      <span className="sai-link" onClick={() => onAll(false)}>{t("pr.none")}</span>
    </div>
  );
}

/** Groups of a split: rename a group, move a track to another group or out of all groups. */
function SplitEditor({ proposal, onChange }: { proposal: SplitProposal; onChange: (next: SplitProposal) => void }) {
  const rename = (index: number, name: string) =>
    onChange({ ...proposal, groups: proposal.groups.map((g, i) => (i === index ? { ...g, name } : g)) });
  const move = (track: Track, from: number, to: number) => {
    const groups = proposal.groups.map((g, i) => {
      if (i === from) return { ...g, tracks: g.tracks.filter((x) => x.uid !== track.uid) };
      if (i === to) return { ...g, tracks: [...g.tracks, track] };
      return g;
    });
    onChange({ ...proposal, groups, leftOut: proposal.leftOut + (to === -1 ? 1 : 0) });
  };
  return (
    <div style={scroll}>
      {proposal.groups.map((group, index) => (
        <details key={index} style={{ padding: "6px 0" }}>
          <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="chevron" size={14} />
            <input className="sai-groupname" value={group.name} onClick={(e: any) => e.stopPropagation()}
                   onChange={(e: any) => rename(index, e.target.value)} />
            <span style={{ ...css.muted, flex: "none" }}>{count(group.tracks.length, "track")}</span>
          </summary>
          <div style={{ marginLeft: 8 }}>
            {group.tracks.slice(0, MAX_ROWS).map((track) => (
              <TrackRow key={track.uid} uri={track.uri} name={track.name} imageUrl={track.imageUrl} local={track.local}
                        sub={track.artists.join(", ")} onPlay={spotify.playTrack}
                        right={
                          <select className="sai-select" value={index} onChange={(e: any) => move(track, index, Number(e.target.value))}>
                            {proposal.groups.map((g, i) => <option key={i} value={i}>{g.name}</option>)}
                            <option value={-1}>{t("pr.noGroup")}</option>
                          </select>
                        } />
            ))}
            {group.tracks.length > MAX_ROWS && <p style={css.muted}>{t("pr.more", { n: group.tracks.length - MAX_ROWS })}</p>}
          </div>
        </details>
      ))}
    </div>
  );
}

type Outcome = Applied | { kind: "undone"; exact: boolean };

function ProposalCard({ initial }: { initial: Proposal; key?: string }) {
  const { useState } = hooks();
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null as Outcome | null);

  const run = async (text: string, job: () => Promise<Outcome>) => {
    setBusy(text);
    setError("");
    try {
      setDone(await job());
    } catch (e) {
      setError(errorText(e));
    }
    setBusy("");
    setConfirming(false);
  };
  const setTracks = (change: (x: ProposedTrack) => ProposedTrack) => {
    if (proposal.kind === "split") return;
    setProposal({ ...proposal, tracks: proposal.tracks.map(change) });
    setConfirming(false);
  };
  const toggle = (uid: string) => setTracks((x) => (x.track.uid === uid ? { ...x, selected: !x.selected } : x));
  const all = (selected: boolean) => setTracks((x) => ({ ...x, selected }));
  const open = (uri: string) => Spicetify.Platform.History.push(`/playlist/${uri.split(":")[2]}`);
  const undo = (snapshot: Snapshot) =>
    run(t("act.undoing"), async () => ({ kind: "undone", exact: (await safeRestore(snapshot, t("undo.backup", { reason: snapshot.reason }))).exact }));
  const target = proposal.kind === "removal" || proposal.kind === "additions" ? proposal.playlist : proposal.source;
  const working = busy && <span style={{ ...css.muted, display: "inline-flex", gap: 8, alignItems: "center" }}><Spinner size={14} />{busy}</span>;

  let body;
  if (done?.kind === "created") {
    body = (
      <div style={css.notice} className="sai-in">
        {t("res.created")}{" "}
        {done.playlists.map((p, i) => (
          <span key={p.uri}>{i > 0 && ", "}<a style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => open(p.uri)}>{p.name}</a> ({p.tracks})</span>
        ))}
        . {t("res.createdNote")}
      </div>
    );
  } else if (done?.kind === "removed") {
    body = (
      <div style={css.notice} className="sai-in">
        {t("res.removed", { tracks: count(done.removed, "track") })}{" "}
        <button style={css.secondary} disabled={!!busy} onClick={() => undo(done.snapshot)}>{t("act.undo")}</button>
        <div style={css.muted}>{t("res.undoNote")}</div>
      </div>
    );
  } else if (done?.kind === "added") {
    body = (
      <div style={css.notice} className="sai-in">
        {t("res.added", { tracks: count(done.added, "track"), name: done.playlistName })}{" "}
        <button style={css.secondary} disabled={!!busy} onClick={() => undo(done.snapshot)}>{t("act.undo")}</button>
      </div>
    );
  } else if (done?.kind === "undone") {
    body = <div style={css.notice} className="sai-in">{t(done.exact ? "res.undone" : "res.undoneInexact")}</div>;
  } else if (proposal.kind === "new_playlist") {
    const n = proposal.tracks.filter((x) => x.selected).length;
    const unsure = proposal.tracks.filter((x) => x.reason).length;
    body = (
      <div>
        <input style={{ ...css.input, margin: "10px 0 4px" }} value={proposal.name} onChange={(e: any) => setProposal({ ...proposal, name: e.target.value })} />
        {unsure > 0 && <p style={css.muted}>{t("pr.unsure", { n: unsure })}</p>}
        <SelectBar tracks={proposal.tracks} onAll={all} />
        <TrackRows tracks={proposal.tracks} onToggle={toggle} />
        <div style={actions}>
          <button style={css.primary} disabled={!!busy || n === 0 || !proposal.name.trim()} onClick={() => run(t("act.creating"), () => applyNewPlaylist(port, proposal))}>
            {t("pr.create", { tracks: count(n, "track") })}
          </button>
          {working}
        </div>
      </div>
    );
  } else if (proposal.kind === "additions") {
    const n = proposal.tracks.filter((x) => x.selected).length;
    const name = proposal.playlist.name;
    body = (
      <div>
        <p style={css.muted}>{t("pr.additionsHint", { name })}</p>
        <SelectBar tracks={proposal.tracks} onAll={all} />
        <TrackRows tracks={proposal.tracks} onToggle={toggle} />
        <div style={actions}>
          <button style={css.primary} disabled={!!busy || n === 0} onClick={() => run(t("act.creating"), () => applyAdditionsAsNew(port, proposal, t("pr.recName", { name })))}>
            {t("pr.saveNew", { n })}
          </button>
          {proposal.playlist.editable && !confirming && (
            <button style={css.secondary} disabled={!!busy || n === 0} onClick={() => setConfirming(true)}>{t("pr.addTo", { name })}</button>
          )}
          {confirming && (
            <span style={confirmRow}>
              <span style={{ marginRight: 16 }}>{t("pr.confirmAdd", { tracks: count(n, "track"), name })}</span>
              <button style={{ ...css.primary, marginRight: 12 }} disabled={!!busy} onClick={() => run(t("act.adding"), () => applyAdditionsInPlace(port, proposal))}>{t("pr.yesAdd")}</button>
              <button style={css.secondary} onClick={() => setConfirming(false)}>{t("act.cancel")}</button>
            </span>
          )}
          {working}
        </div>
      </div>
    );
  } else if (proposal.kind === "removal") {
    const n = proposal.tracks.filter((x) => x.selected).length;
    const name = proposal.playlist.name;
    body = (
      <div>
        <p style={css.muted}>{t("pr.removalHint", { name })}</p>
        <SelectBar tracks={proposal.tracks} onAll={all} />
        <TrackRows tracks={proposal.tracks} onToggle={toggle} />
        <div style={actions}>
          <button style={css.primary} disabled={!!busy || n === 0} onClick={() => run(t("act.creating"), () => applyRemovalAsCopy(port, proposal, t("pr.cleanedName", { name })))}>
            {t("act.cleanCopy", { n })}
          </button>
          {proposal.playlist.editable && !confirming && (
            <button style={css.secondary} disabled={!!busy || n === 0} onClick={() => setConfirming(true)}>{t("act.removeHere")}</button>
          )}
          {confirming && (
            <span style={confirmRow}>
              <span style={{ marginRight: 16 }}>{t("act.confirmRemove", { tracks: count(n, "track"), name })}</span>
              <button style={{ ...css.danger, marginRight: 12 }} disabled={!!busy} onClick={() => run(t("act.removing"), () => applyRemovalInPlace(port, proposal))}>{t("act.yesRemove")}</button>
              <button style={css.secondary} onClick={() => setConfirming(false)}>{t("act.cancel")}</button>
            </span>
          )}
          {working}
        </div>
      </div>
    );
  } else {
    const groups = proposal.groups.filter((g) => g.tracks.length > 0 && g.name.trim());
    body = (
      <div>
        <p style={css.muted}>
          {t("pr.splitHint", { name: proposal.source.name })}
          {proposal.leftOut > 0 && ` ${t("pr.leftOut", { tracks: count(proposal.leftOut, "track") })}`}
        </p>
        <SplitEditor proposal={proposal} onChange={setProposal} />
        <div style={actions}>
          <button style={css.primary} disabled={!!busy || groups.length === 0} onClick={() => run(t("act.creating"), () => applySplit(port, { ...proposal, groups }))}>
            {t("pr.createN", { playlists: count(groups.length, "playlist") })}
          </button>
          {working}
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...css.group, border: "1px solid rgba(255,255,255,.12)" }} className="sai-in">
      {/* The headline is written by the app from real data; the model's own summary is plain text below it. */}
      <div className="sai-kind">{t(`pr.kind.${proposal.kind}` as Key)}</div>
      <div style={{ fontWeight: 700, fontSize: 16, margin: "4px 0 2px", lineHeight: 1.35 }}>
        {t(`pr.kind.${proposal.kind}` as Key)} {t("pr.for", { name: target.name })}
      </div>
      {proposal.summary && <div style={{ ...css.muted, fontSize: 14 }}>{proposal.summary}</div>}
      {error && <p style={css.error}>{error}</p>}
      {body}
    </div>
  );
}

interface Message {
  from: "user" | "agent" | "error" | "note";
  text: string;
  proposals: Proposal[];
}
interface Progress {
  text: string;
  done?: number;
  total?: number;
}

const EXAMPLES: Key[] = ["ex.1", "ex.2", "ex.3", "ex.4", "ex.5"];

export function AgentView({ onBack, onSettings, initialPrompt = "", playlist }: { onBack: () => void; onSettings: () => void; initialPrompt?: string; playlist?: Playlist }) {
  const { useRef, useState } = hooks();
  const [settings] = useState(loadSettings());
  const [agent, setAgent] = useState(null as Agent | null);
  const [messages, setMessages] = useState([] as Message[]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [progress, setProgress] = useState(null as Progress | null);
  // Identifies the run that is allowed to write to the screen; "Stop" makes the old run a stranger.
  const runId = useRef(0);
  const running = useRef(null as Agent | null);

  const ready = isConfigured(settings);
  const send = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || progress || !ready) return;
    const current = agent ?? new Agent(settings, port, undefined, playlist?.uri);
    if (!agent) setAgent(current);
    const id = ++runId.current;
    running.current = current;
    const history: Message[] = [...messages, { from: "user", text, proposals: [] }];
    setMessages(history);
    setPrompt("");
    setProgress({ text: t("ag.thinking") });
    const mine = () => runId.current === id;
    try {
      const result = await current.run(text, (e) => {
        if (!mine()) return;
        if (e.type === "tool") setProgress({ text: t(`tool.${e.name}` as Key) });
        else if (e.type === "progress") setProgress({ text: t("progress.checking", { done: e.done, total: e.total }), done: e.done, total: e.total });
        else if (e.type === "thinking") setProgress({ text: t("ag.thinking") });
      });
      if (!mine()) return;
      const reply = result.incomplete ? t(result.proposals.length ? "ag.partial" : "ag.failed") : result.text;
      setMessages([...history, { from: "agent", text: reply, proposals: result.proposals }]);
      if (result.incomplete) setAgent(null);
    } catch (e) {
      if (!mine()) return;
      setMessages([...history, { from: "error", text: errorText(e), proposals: [] }]);
      setAgent(null); // a failed conversation is not continued
    }
    setProgress(null);
  };

  const stop = () => {
    running.current?.cancel();
    runId.current++;
    setAgent(null);
    setProgress(null);
    setMessages([...messages, { from: "note", text: t("ag.stopped"), proposals: [] }]);
  };
  const reset = () => {
    setMessages([]);
    setAgent(null);
  };

  return (
    <div style={{ ...css.column, marginTop: 20, display: "flex", flexDirection: "column", minHeight: "calc(100vh - 330px)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BackLink label={t("back.tools")} onClick={onBack} />
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {messages.length > 0 && <span className="sai-link" style={{ marginRight: 8 }} onClick={reset}><Icon name="plus" size={14} />{t("ag.new")}</span>}
        </span>
      </div>

      {!ready && (
        <div style={{ ...css.notice, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span>{t("ag.needModel")}</span>
          <button style={css.primary} onClick={onSettings}>{t("ag.openSettings")}</button>
        </div>
      )}

      {ready && messages.length === 0 && (
        <div className="sai-in" style={{ textAlign: "center", margin: "auto 0", padding: "24px 0" }}>
          <div style={{ ...avatar, width: 44, height: 44, margin: "0 auto 14px" }}><Icon name="spark" size={24} /></div>
          <h2 style={{ fontSize: 22, margin: "0 0 6px" }}>{t("ag.title")}</h2>
          <p style={{ ...css.muted, maxWidth: 460, margin: "0 auto 22px" }}>{t("ag.intro")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {EXAMPLES.map((key) => <span key={key} className="sai-chip" onClick={() => setPrompt(t(key))}>{t(key)}</span>)}
          </div>
        </div>
      )}

      <div style={{ flex: messages.length ? 1 : "none" }}>
        {messages.map((m, i) => (
          <div key={i} className="sai-in">
            {m.from === "user" && <div style={{ display: "flex", margin: "18px 0 6px" }}><div style={mine}>{m.text}</div></div>}
            {m.from === "note" && <p style={{ ...css.muted, textAlign: "center", margin: "14px 0" }}>{m.text}</p>}
            {(m.from === "agent" || m.from === "error") && (
              <div style={turn}>
                <div style={m.from === "error" ? { ...avatar, background: "#f15e6c" } : avatar}>
                  <Icon name={m.from === "error" ? "cross" : "spark"} size={16} />
                </div>
                <div style={m.from === "error" ? { ...answer, color: "#f15e6c" } : answer}>{m.text}</div>
              </div>
            )}
            {m.proposals.length > 0 && <div style={{ marginLeft: 40 }}>{m.proposals.map((p) => <ProposalCard key={`${i}-${p.id}`} initial={p} />)}</div>}
          </div>
        ))}
        {progress && (
          <div style={turn} className="sai-in">
            <div style={avatar}><Icon name="spark" size={16} /></div>
            <div style={{ ...css.muted, paddingTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Dots />{progress.text}</div>
              {progress.total !== undefined && <ProgressBar done={progress.done ?? 0} total={progress.total} />}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={send} style={{ position: "sticky", bottom: 0, padding: "14px 0 18px", background: "linear-gradient(transparent, var(--spice-main, #121212) 30%)" }}>
        <div className="sai-composer" style={{ ...composer, opacity: ready ? 1 : 0.5 }}>
          <input style={composerInput} value={prompt} disabled={!ready || !!progress}
                 placeholder={t(messages.length ? "ag.placeholderReply" : "ag.placeholder")}
                 onChange={(e: any) => setPrompt(e.target.value)} />
          {progress
            ? <button type="button" className="sai-send" title={t("ag.stop")} onClick={stop} style={{ background: "var(--spice-text, #fff)" }}><Icon name="stop" size={16} /></button>
            : <button type="submit" className="sai-send" title={t("ag.send")} disabled={!ready || !prompt.trim()}><Icon name="send" size={18} /></button>}
        </div>
      </form>
    </div>
  );
}
