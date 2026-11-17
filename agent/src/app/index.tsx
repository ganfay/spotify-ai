// The agent's page. Phase 2 shell: proves that the page loads, that the Spotify
// adapter works, and gives a place for the input field. No AI yet.

import * as spotify from "../spotify/adapter";
import type { Playlist } from "../spotify/types";
import { listSnapshots } from "../snapshots";

declare const Spicetify: any;
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [tag: string]: any;
    }
  }
}

const styles = {
  page: { padding: "24px 32px", maxWidth: 820 },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--spice-button-disabled, #535353)",
    background: "var(--spice-card, #181818)", color: "var(--spice-text, #fff)", fontSize: 15, boxSizing: "border-box",
  },
  muted: { color: "var(--spice-subtext, #b3b3b3)", fontSize: 13 },
  row: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.07)" },
} as const;

function App() {
  const { useEffect, useState } = Spicetify.React;
  const [playlists, setPlaylists] = useState(null as Playlist[] | null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    spotify.listPlaylists().then(setPlaylists, (e: Error) => setError(e.message));
  }, []);

  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (prompt.trim()) setNote("The AI is not connected yet — this is the Phase 2 shell.");
  };

  const editable = playlists?.filter((p: Playlist) => p.editable) ?? [];
  return (
    <section style={styles.page}>
      <h1 style={{ marginBottom: 4 }}>AI Playlists</h1>
      <p style={styles.muted}>Describe what to do with your playlists. Nothing changes until you confirm.</p>

      <form onSubmit={submit} style={{ margin: "20px 0 8px" }}>
        <input
          style={styles.input}
          value={prompt}
          placeholder='For example: "remove duplicates from my biggest playlist"'
          onChange={(e: any) => setPrompt(e.target.value)}
        />
      </form>
      {note && <p style={styles.muted}>{note}</p>}
      {error && <p style={{ color: "#f15e6c" }}>{error}</p>}

      <h2 style={{ fontSize: 18, margin: "28px 0 8px" }}>
        Your playlists {playlists && <span style={styles.muted}>({editable.length} editable of {playlists.length})</span>}
      </h2>
      {!playlists && !error && <p style={styles.muted}>Loading…</p>}
      {playlists?.map((p: Playlist) => (
        <div key={p.uri} style={styles.row}>
          <span>{p.name}{!p.editable && <span style={styles.muted}> · read-only</span>}</span>
          <span style={styles.muted}>{p.trackCount} tracks</span>
        </div>
      ))}
      <p style={{ ...styles.muted, marginTop: 20 }}>Saved undo points: {listSnapshots().length}</p>
    </section>
  );
}

export function render() {
  return <App />;
}
