// Shared styles and helpers of the agent's pages.

declare const Spicetify: any;

export interface Hooks {
  useState<T>(initial: T): [T, (value: T) => void];
  useEffect(effect: () => void, deps?: unknown[]): void;
}
export const hooks = (): Hooks => Spicetify.React;
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [tag: string]: any;
    }
  }
}

export const css = {
  page: { padding: "24px 32px", maxWidth: 860 },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--spice-button-disabled, #535353)",
    background: "var(--spice-card, #181818)", color: "var(--spice-text, #fff)", fontSize: 15, boxSizing: "border-box",
  },
  muted: { color: "var(--spice-subtext, #b3b3b3)", fontSize: 13 },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px",
    borderBottom: "1px solid rgba(255,255,255,.07)", cursor: "pointer", borderRadius: 4,
  },
  group: { background: "var(--spice-card, #181818)", borderRadius: 8, padding: "14px 18px", margin: "12px 0" },
  entry: { display: "flex", alignItems: "center", gap: 14, padding: "8px 0", cursor: "pointer" },
  tag: { fontSize: 11, padding: "1px 7px", borderRadius: 10, background: "rgba(255,255,255,.12)", marginLeft: 6 },
  bar: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", margin: "28px 0 40px" },
  primary: { padding: "12px 28px", borderRadius: 500, fontSize: 14, border: 0, fontWeight: 700, cursor: "pointer", background: "var(--spice-button, #1ed760)", color: "#000" },
  secondary: { padding: "12px 28px", borderRadius: 500, fontSize: 14, border: "1px solid var(--spice-subtext, #b3b3b3)", fontWeight: 700, cursor: "pointer", background: "transparent", color: "var(--spice-text, #fff)" },
  danger: { padding: "12px 28px", borderRadius: 500, fontSize: 14, border: 0, fontWeight: 700, cursor: "pointer", background: "#e22134", color: "#fff" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16, marginTop: 24 },
  card: { background: "var(--spice-card, #181818)", borderRadius: 8, padding: "18px 20px", minHeight: 96 },
  badge: { fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(255,255,255,.12)", marginLeft: 8 },
  notice: { background: "rgba(30,215,96,.12)", borderRadius: 8, padding: "12px 14px", margin: "14px 0" },
  error: { color: "#f15e6c", margin: "10px 0" },
} as const;

export const duration = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// ---------------------------------------------------------------- visuals
// Icons are small inline SVGs drawn for this project. No emoji anywhere in the UI.

const GREEN = "var(--spice-button, #1ed760)";
const RED = "#f15e6c";

/** Animations and hover states. Rendered once at the top of the page. */
export function GlobalStyles() {
  return (
    <style>{`
      @keyframes sai-spin { to { transform: rotate(360deg); } }
      @keyframes sai-pop { 0% { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
      @keyframes sai-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes sai-draw { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }
      @keyframes sai-dot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
      .sai-in { animation: sai-in .22s ease-out both; }
      .sai-link { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: var(--spice-subtext, #b3b3b3); font-size: 13px; transition: color .15s; }
      .sai-link:hover { color: var(--spice-text, #fff); }
      .sai-iconbtn { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; border: 0; background: transparent; color: var(--spice-subtext, #b3b3b3); transition: background .15s, color .15s; }
      .sai-iconbtn:hover { background: rgba(255,255,255,.1); color: var(--spice-text, #fff); }
      .sai-chip { cursor: pointer; padding: 8px 14px; border-radius: 500px; background: rgba(255,255,255,.07); font-size: 13px; transition: background .15s; }
      .sai-chip:hover { background: rgba(255,255,255,.14); }
      .sai-card { transition: background .15s, transform .15s; }
      .sai-card.ready:hover { background: rgba(255,255,255,.1) !important; transform: translateY(-1px); }
      .sai-send { cursor: pointer; width: 36px; height: 36px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; background: var(--spice-button, #1ed760); color: #000; transition: transform .12s, opacity .15s; flex: none; }
      .sai-send:hover:not(:disabled) { transform: scale(1.06); }
      .sai-send:disabled { opacity: .35; cursor: default; }
      .sai-composer:focus-within { border-color: rgba(255,255,255,.35) !important; }
      .sai-composer input { outline: none; }
    `}</style>
  );
}

type IconName = "settings" | "back" | "check" | "cross" | "send" | "spark" | "plus";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  let body;
  switch (name) {
    case "settings":
      // A gear: a ring with eight teeth.
      body = (
        <g fill="currentColor">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="10.4" y="1.6" width="3.2" height="5" rx="1.2" transform={`rotate(${a} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" strokeWidth="3.2" />
        </g>
      );
      break;
    case "back": body = <path d="M15 5l-7 7 7 7" {...stroke} />; break;
    case "check": body = <path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} strokeWidth={2.4} />; break;
    case "cross": body = <path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth={2.4} />; break;
    case "send": body = <path d="M12 19V5M5.500 11.500L12 5l6.500 6.500" {...stroke} strokeWidth={2.4} />; break;
    case "plus": body = <path d="M12 5v14M5 12h14" {...stroke} />; break;
    case "spark":
      body = <path fill="currentColor" d="M10 2.500l2.200 5.800 5.800 2.200-5.800 2.200L10 18.500l-2.200-5.800L2 10.500l5.800-2.200L10 2.500zm8.500 11.500l1.050 2.700 2.700 1.050-2.700 1.050-1.050 2.700-1.050-2.700-2.700-1.050 2.700-1.050L18.500 14z" />;
      break;
  }
  return <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: "none", display: "block" }} aria-hidden="true">{body}</svg>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flex: "none", animation: "sai-spin .8s linear infinite" }} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Three pulsing dots: "the model is working". */
export function Dots() {
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", animation: `sai-dot 1.2s ${i * 0.18}s infinite` }} />
      ))}
    </span>
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return <span className="sai-link" onClick={onClick}><Icon name="back" size={14} />{label}</span>;
}

/** Result of a check, in the style of an IDE's "Test connection": a coloured badge that pops in. */
export function ResultBadge({ ok, title, detail }: { ok: boolean; title: string; detail?: string }) {
  const color = ok ? GREEN : RED;
  return (
    <div className="sai-in" style={{
      display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 8, margin: "4px 0 16px",
      background: ok ? "rgba(30,215,96,.1)" : "rgba(241,94,108,.1)", border: `1px solid ${ok ? "rgba(30,215,96,.35)" : "rgba(241,94,108,.35)"}`,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: "50%", background: color, color: "#000", flex: "none",
        display: "flex", alignItems: "center", justifyContent: "center", animation: "sai-pop .35s ease-out both",
      }}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d={ok ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"} fill="none" stroke="currentColor" strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" style={{ animation: "sai-draw .35s .15s ease-out both" }} />
        </svg>
      </span>
      <span>
        <div style={{ fontWeight: 700, color }}>{title}</div>
        {detail && <div style={{ ...css.muted, marginTop: 2 }}>{detail}</div>}
      </span>
    </div>
  );
}
