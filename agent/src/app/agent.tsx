// The AI agent's chat. The agent only proposes; every change happens in a
// ProposalCard after the user's click.

import { Agent, toolLabel } from "../agent/loop";
import {
  type Applied, applyNewPlaylist, applyRemovalAsCopy, applyRemovalInPlace, applySplit,
  type Proposal, type ProposedTrack, type SpotifyPort,
} from "../agent/proposals";
import { isConfigured, loadSettings } from "../settings";
import { restoreSnapshot } from "../snapshots";
import * as spotify from "../spotify/adapter";
import { BackLink, css, Dots, duration, hooks, Icon, Spinner } from "./ui";

declare const Spicetify: any;

const port: SpotifyPort = spotify;
const MAX_ROWS = 300;

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

function TrackRows({ tracks, onToggle }: { tracks: ProposedTrack[]; onToggle?: (uid: string) => void }) {
  return (
    <div style={scroll}>
      {tracks.slice(0, MAX_ROWS).map(({ track, reason, selected }) => (
        <label key={track.uid} style={css.entry}>
          {onToggle && <input type="checkbox" checked={selected} onChange={() => onToggle(track.uid)} />}
          <span style={{ flex: 1 }}>
            {track.name}
            <div style={css.muted}>{track.artists.join(", ")}{reason && <span> — {reason}</span>}</div>
          </span>
          <span style={css.muted}>{duration(track.durationMs)}</span>
        </label>
      ))}
      {tracks.length > MAX_ROWS && <p style={css.muted}>…and {tracks.length - MAX_ROWS} more (they follow their checkbox state too).</p>}
    </div>
  );
}

function ProposalCard({ initial }: { initial: Proposal; key?: string }) {
  const { useState } = hooks();
  const [proposal, setProposal] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null as Applied | { kind: "undone"; exact: boolean } | null);

  const run = async (text: string, job: () => Promise<Applied | { kind: "undone"; exact: boolean }>) => {
    setBusy(text);
    setError("");
    try {
      setDone(await job());
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
    setConfirming(false);
  };
  const toggle = (uid: string) => {
    if (proposal.kind === "split") return;
    setProposal({ ...proposal, tracks: proposal.tracks.map((t) => (t.track.uid === uid ? { ...t, selected: !t.selected } : t)) });
    setConfirming(false);
  };
  const open = (uri: string) => Spicetify.Platform.History.push(`/playlist/${uri.split(":")[2]}`);

  let body;
  if (done?.kind === "created") {
    body = (
      <div style={css.notice}>
        Created:{" "}
        {done.playlists.map((p, i) => (
          <span key={p.uri}>{i > 0 && ", "}<a style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => open(p.uri)}>{p.name}</a> ({p.tracks})</span>
        ))}
        . Your other playlists were not changed.
      </div>
    );
  } else if (done?.kind === "removed") {
    const snapshot = done.snapshot;
    body = (
      <div style={css.notice}>
        Removed {done.removed} tracks.{" "}
        <button style={css.secondary} disabled={!!busy} onClick={() => run("Undoing…", async () => ({ kind: "undone", exact: (await restoreSnapshot(snapshot)).exact }))}>Undo</button>
        <div style={css.muted}>Tracks brought back by undo get today’s “date added”.</div>
      </div>
    );
  } else if (done?.kind === "undone") {
    body = <div style={css.notice}>{done.exact ? "Undone. The playlist is back to how it was." : "Undo finished, but the playlist does not match the saved state exactly — please check it."}</div>;
  } else if (proposal.kind === "new_playlist") {
    const count = proposal.tracks.filter((t) => t.selected).length;
    const unsure = proposal.tracks.filter((t) => t.reason).length;
    body = (
      <div>
        <input style={{ ...css.input, margin: "8px 0" }} value={proposal.name} onChange={(e: any) => setProposal({ ...proposal, name: e.target.value })} />
        {unsure > 0 && <p style={css.muted}>The first {unsure} are the ones the AI was not sure about — tick those you want to keep.</p>}
        <TrackRows tracks={proposal.tracks} onToggle={toggle} />
        <div style={{ ...css.bar, margin: "12px 0 4px" }}>
          <button style={css.primary} disabled={!!busy || count === 0 || !proposal.name.trim()} onClick={() => run("Creating…", () => applyNewPlaylist(port, proposal))}>
            Create playlist ({count} tracks)
          </button>
          {busy && <span style={css.muted}>{busy}</span>}
        </div>
      </div>
    );
  } else if (proposal.kind === "removal") {
    const count = proposal.tracks.filter((t) => t.selected).length;
    body = (
      <div>
        <p style={css.muted}>From “{proposal.playlist.name}”. Ticked = will be removed.</p>
        <TrackRows tracks={proposal.tracks} onToggle={toggle} />
        <div style={{ ...css.bar, margin: "12px 0 4px" }}>
          <button style={css.primary} disabled={!!busy || count === 0} onClick={() => run("Creating the cleaned copy…", () => applyRemovalAsCopy(port, proposal))}>
            Create a cleaned copy ({count} left out)
          </button>
          {proposal.playlist.editable && !confirming && (
            <button style={css.secondary} disabled={!!busy || count === 0} onClick={() => setConfirming(true)}>Remove from this playlist…</button>
          )}
          {confirming && (
            <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12 }}>
              <span style={{ marginRight: 16 }}>Remove {count} tracks from “{proposal.playlist.name}”?</span>
              <button style={{ ...css.danger, marginRight: 12 }} disabled={!!busy} onClick={() => run("Removing…", () => applyRemovalInPlace(port, proposal))}>Yes, remove</button>
              <button style={css.secondary} onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
          {busy && <span style={css.muted}>{busy}</span>}
        </div>
      </div>
    );
  } else {
    body = (
      <div>
        <p style={css.muted}>
          From “{proposal.source.name}”. The original stays as it is.
          {proposal.leftOut > 0 && ` ${proposal.leftOut} tracks are in no group.`}
        </p>
        <div style={scroll}>
          {proposal.groups.map((g) => (
            <details key={g.name} style={{ padding: "6px 0" }}>
              <summary style={{ cursor: "pointer" }}><b>{g.name}</b> <span style={css.muted}>· {g.tracks.length} tracks</span></summary>
              <TrackRows tracks={g.tracks.map((track) => ({ track, reason: "", selected: true }))} />
            </details>
          ))}
        </div>
        <div style={{ ...css.bar, margin: "12px 0 4px" }}>
          <button style={css.primary} disabled={!!busy} onClick={() => run("Creating…", () => applySplit(port, proposal))}>Create {proposal.groups.length} playlists</button>
          {busy && <span style={css.muted}>{busy}</span>}
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...css.group, border: "1px solid rgba(255,255,255,.12)" }}>
      <div style={{ fontWeight: 700 }}>{proposal.summary || "Proposal"}</div>
      {error && <p style={css.error}>{error}</p>}
      {body}
    </div>
  );
}

interface Message {
  from: "user" | "agent" | "error";
  text: string;
  proposals: Proposal[];
}

const EXAMPLES = [
  "Find duplicates in my biggest playlist",
  "Take “…” and make a new playlist without anything in Russian",
  "Split “…” into 3 playlists by mood",
  "Which tracks do not fit in “…”? Explain why",
];

export function AgentView({ onBack, onSettings }: { onBack: () => void; onSettings: () => void }) {
  const { useState } = hooks();
  const [settings] = useState(loadSettings());
  const [agent, setAgent] = useState(null as Agent | null);
  const [messages, setMessages] = useState([] as Message[]);
  const [prompt, setPrompt] = useState("");
  const [progress, setProgress] = useState("");

  const ready = isConfigured(settings);
  const send = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || progress || !ready) return;
    const current = agent ?? new Agent(settings, port);
    if (!agent) setAgent(current);
    const history: Message[] = [...messages, { from: "user", text, proposals: [] }];
    setMessages(history);
    setPrompt("");
    setProgress("Thinking");
    try {
      const result = await current.run(text, (e) => setProgress(e.type === "tool" ? toolLabel(e.name) : "Thinking"));
      setMessages([...history, { from: "agent", text: result.text, proposals: result.proposals }]);
    } catch (e) {
      setMessages([...history, { from: "error", text: (e as Error).message, proposals: [] }]);
      setAgent(null); // a failed conversation is not continued
    }
    setProgress("");
  };

  const reset = () => {
    setMessages([]);
    setAgent(null);
  };
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BackLink label="All tools" onClick={onBack} />
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {messages.length > 0 && <span className="sai-link" style={{ marginRight: 8 }} onClick={reset}><Icon name="plus" size={14} />New conversation</span>}
          <button className="sai-iconbtn" title="Settings" onClick={onSettings}><Icon name="settings" size={18} /></button>
        </span>
      </div>

      {!ready && (
        <div style={{ ...css.notice, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span>The agent needs access to an AI model.</span>
          <button style={css.primary} onClick={onSettings}>Open Settings</button>
        </div>
      )}

      {ready && messages.length === 0 && (
        <div className="sai-in" style={{ textAlign: "center", padding: "48px 0 28px" }}>
          <div style={{ ...avatar, width: 44, height: 44, margin: "0 auto 14px" }}><Icon name="spark" size={24} /></div>
          <h2 style={{ fontSize: 22, margin: "0 0 6px" }}>What should I do with your playlists?</h2>
          <p style={{ ...css.muted, maxWidth: 460, margin: "0 auto 22px" }}>
            Ask in your own words, in any language. I read your playlists and show a proposal — nothing changes until you press a button.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            {EXAMPLES.map((e) => <span key={e} className="sai-chip" onClick={() => setPrompt(e)}>{e}</span>)}
          </div>
        </div>
      )}

      <div>
        {messages.map((m, i) => (
          <div key={i} className="sai-in">
            {m.from === "user" && <div style={{ display: "flex", margin: "18px 0 6px" }}><div style={mine}>{m.text}</div></div>}
            {m.from !== "user" && (
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
            <div style={{ ...css.muted, display: "flex", alignItems: "center", gap: 10, paddingTop: 6 }}><Dots />{progress}</div>
          </div>
        )}
      </div>

      <form onSubmit={send} style={{ margin: "22px 0 40px" }}>
        <div className="sai-composer" style={{ ...composer, opacity: ready ? 1 : 0.5 }}>
          <input style={composerInput} value={prompt} disabled={!ready || !!progress}
                 placeholder={messages.length ? "Reply or ask for something else" : "Message the agent"}
                 onChange={(e: any) => setPrompt(e.target.value)} />
          <button type="submit" className="sai-send" title="Send" disabled={!ready || !!progress || !prompt.trim()}>
            {progress ? <Spinner size={16} /> : <Icon name="send" size={18} />}
          </button>
        </div>
      </form>
    </div>
  );
}
