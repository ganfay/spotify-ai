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
