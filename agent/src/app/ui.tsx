// Shared styles and helpers of the agent's pages.

import { t } from "./i18n";

declare const Spicetify: any;

export interface Hooks {
  /** A function as the initial value runs once (do this for anything read from storage). */
  useState<T>(initial: T | (() => T)): [T, (value: T) => void];
  useEffect(effect: () => void, deps?: unknown[]): void;
  useRef<T>(initial: T): { current: T };
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
  // On macOS the top strip of Spotify's main view is a handle for dragging the window:
  // clicks there move the window instead of reaching buttons. Our page opts out.
  page: { padding: "24px 32px", WebkitAppRegion: "no-drag" },
  column: { maxWidth: 820, margin: "0 auto" },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--spice-button-disabled, #535353)",
    background: "var(--spice-card, #181818)", color: "var(--spice-text, #fff)", fontSize: 15, boxSizing: "border-box",
  },
  muted: { color: "var(--spice-subtext, #b3b3b3)", fontSize: 13 },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px",
    borderBottom: "1px solid rgba(var(--spice-rgb-text, 255,255,255),.07)", cursor: "pointer", borderRadius: 4,
  },
  group: { background: "var(--spice-card, #181818)", borderRadius: 8, padding: "14px 18px", margin: "12px 0" },
  entry: { display: "flex", alignItems: "center", gap: 14, padding: "8px 0", cursor: "pointer" },
  tag: { fontSize: 11, padding: "1px 7px", borderRadius: 10, background: "rgba(var(--spice-rgb-text, 255,255,255),.12)", marginLeft: 6 },
  bar: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", margin: "28px 0 40px" },
  primary: { padding: "12px 28px", borderRadius: 500, fontSize: 14, border: 0, fontWeight: 700, cursor: "pointer", background: "var(--spice-button, #1ed760)", color: "var(--sai-on-accent, #000)" },
  secondary: { padding: "12px 28px", borderRadius: 500, fontSize: 14, border: "1px solid var(--spice-subtext, #b3b3b3)", fontWeight: 700, cursor: "pointer", background: "transparent", color: "var(--spice-text, #fff)" },
  danger: { padding: "12px 28px", borderRadius: 500, fontSize: 14, border: 0, fontWeight: 700, cursor: "pointer", background: "#e22134", color: "#fff" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 24 },
  small: { padding: "7px 16px", borderRadius: 500, fontSize: 13, border: "1px solid var(--spice-subtext, #b3b3b3)", fontWeight: 700, cursor: "pointer", background: "transparent", color: "var(--spice-text, #fff)", flex: "none" },
  card: { background: "var(--spice-card, #181818)", borderRadius: 8, padding: "20px 22px", minHeight: 104 },
  badge: { fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "rgba(var(--spice-rgb-text, 255,255,255),.12)", marginLeft: 8 },
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
      .sai-chatrow { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; cursor: pointer; transition: background .15s; }
      .sai-chatrow:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.07); }
      .sai-range { -webkit-appearance: none; appearance: none; flex: 1; width: 100%; height: 6px; border-radius: 3px; background: rgba(var(--spice-rgb-text, 255,255,255),.18); outline: none; cursor: pointer; }
      .sai-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--spice-text, #fff); border: 2px solid var(--spice-main, #121212); box-shadow: 0 1px 4px rgba(0,0,0,.5); transition: transform .12s; }
      .sai-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
      .sai-swatch { width: 30px; height: 30px; flex: none; border-radius: 50%; border: 2px solid rgba(var(--spice-rgb-text, 255,255,255),.35); cursor: pointer; transition: transform .12s; }
      .sai-swatch:hover { transform: scale(1.08); }
      .sai-hex { width: 92px; background: rgba(var(--spice-rgb-text, 255,255,255),.07); color: var(--spice-text, #fff); border: 1px solid transparent; border-radius: 6px; padding: 6px 8px; font-size: 13px; font-family: ui-monospace, monospace; }
      .sai-hex:focus { border-color: var(--spice-button, #1ed760); outline: none; }
      .sai-look { cursor: pointer; border-radius: 10px; padding: 6px; background: rgba(var(--spice-rgb-text, 255,255,255),.05); border: 2px solid transparent; transition: transform .15s, background .15s, border-color .15s; }
      .sai-look:hover { transform: translateY(-2px); background: rgba(var(--spice-rgb-text, 255,255,255),.1); }
      .sai-look.on { border-color: var(--spice-button, #1ed760); }
      .sai-look .pic { position: relative; height: 64px; border-radius: 6px; }
      .sai-look .dot { position: absolute; right: 8px; bottom: 8px; width: 18px; height: 18px; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,.45); }
      .sai-look .name { font-size: 13px; font-weight: 700; padding: 7px 2px 2px; }
      .sai-theme .pic { height: 104px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .sai-theme .word { font-size: 26px; font-weight: 800; color: #fff; }
      .sai-theme-noir { background: radial-gradient(60% 70% at 25% 10%, rgba(255,255,255,.22), transparent 70%), radial-gradient(50% 60% at 90% 100%, rgba(255,255,255,.12), transparent 70%), #000; box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }
      .sai-theme-noir .word { font-family: "Sai Gothic", "UnifrakturMaguntia", Georgia, serif; font-weight: 600; font-size: 40px; text-shadow: 0 0 2px #fff, 0 0 16px rgba(255,255,255,.6), 0 0 36px rgba(255,255,255,.25); }
      .sai-theme-glass { background: radial-gradient(70% 80% at 15% 20%, #5b3fd6, transparent 70%), radial-gradient(70% 80% at 90% 30%, #0e7fa8, transparent 70%), radial-gradient(80% 80% at 55% 110%, #a8327e, transparent 70%), #0b0b14; border-radius: 14px !important; }
      .sai-theme-glass .word { padding: 8px 20px; border-radius: 14px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); backdrop-filter: blur(10px); font-weight: 700; font-size: 22px; }
      .sai-theme-neon { background: radial-gradient(90% 120% at 10% 0%, rgba(255,62,165,.55), transparent 60%), radial-gradient(90% 120% at 100% 100%, rgba(34,211,238,.45), transparent 60%), linear-gradient(180deg, #170a34, #06030e); box-shadow: inset 0 0 0 1px rgba(255,62,165,.5); }
      .sai-theme-neon .word { background: linear-gradient(92deg, #fff, #ffb3dc, #8be9f7); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 12px rgba(255,62,165,.7)); }
      html:is([data-sai-gradient="on"], [data-sai-theme="glass"], [data-sai-theme="neon"], [data-sai-theme="noir"]) .sai-dock { background: transparent !important; }
      .sai-look .pic { box-shadow: inset 0 0 0 1px rgba(var(--spice-rgb-text, 255,255,255), .14); }
      .sai-photo-thumb { width: 96px; height: 60px; border-radius: 8px; background-size: cover; background-position: center; box-shadow: inset 0 0 0 1px rgba(var(--spice-rgb-text, 255,255,255), .14); }
      .sai-tour-btn { cursor: pointer; border: 0; border-radius: 500px; padding: 8px 16px; font-size: 13px; font-weight: 700; background: rgba(var(--spice-rgb-text, 255,255,255),.1); color: var(--spice-text, #fff); transition: transform .12s, background .15s; }
      .sai-tour-btn:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.18); transform: scale(1.03); }
      .sai-tour-btn.primary { background: var(--spice-button, #1ed760); color: var(--sai-on-accent, #000); }
      .sai-tour-btn.primary:hover { background: var(--spice-button-active, #3be477); }
      .sai-iconbtn { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; border: 0; background: transparent; color: var(--spice-subtext, #b3b3b3); transition: background .15s, color .15s; }
      .sai-iconbtn:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.1); color: var(--spice-text, #fff); }
      .sai-chip { cursor: pointer; padding: 8px 14px; border-radius: 500px; background: rgba(var(--spice-rgb-text, 255,255,255),.07); font-size: 13px; transition: background .15s; }
      .sai-chip:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.14); }
      @keyframes sai-rise { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
      .sai-card { cursor: pointer; display: flex; gap: 14px; align-items: flex-start; animation: sai-rise .38s cubic-bezier(.2,.8,.2,1) both; transition: background .2s, transform .2s, box-shadow .2s; }
      .sai-card:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.09) !important; transform: translateY(-3px); box-shadow: 0 10px 28px rgba(0,0,0,.35); }
      .sai-card .ico { width: 42px; height: 42px; border-radius: 10px; flex: none; display: flex; align-items: center; justify-content: center; background: rgba(var(--spice-rgb-text, 255,255,255),.07); color: var(--spice-subtext, #b3b3b3); transition: background .2s, color .2s, transform .2s; }
      .sai-card:hover .ico { background: var(--spice-button, #1ed760); color: var(--sai-on-accent, #000); transform: scale(1.06) rotate(-4deg); }
      .sai-pill { -webkit-app-region: no-drag; position: relative; z-index: 1; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px 8px 12px; border-radius: 500px; border: 0; background: rgba(var(--spice-rgb-text, 255,255,255),.07); color: var(--spice-text, #fff); font-size: 13px; font-weight: 700; transition: background .15s, transform .15s; }
      .sai-pill:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.14); }
      .sai-pill svg { transition: transform .35s; }
      .sai-pill:hover svg { transform: rotate(60deg); }
      .sai-kind { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--spice-button, #1ed760); }
      .sai-bar { height: 4px; border-radius: 2px; background: rgba(var(--spice-rgb-text, 255,255,255),.12); overflow: hidden; margin-top: 8px; width: 260px; max-width: 100%; }
      .sai-bar > div { height: 100%; background: var(--spice-button, #1ed760); border-radius: 2px; transition: width .3s ease; }
      .sai-select { background: var(--spice-card, #181818); color: var(--spice-text, #fff); border: 1px solid rgba(var(--spice-rgb-text, 255,255,255),.18); border-radius: 6px; padding: 4px 6px; font-size: 12px; max-width: 150px; }
      .sai-groupname { background: transparent; border: 0; border-bottom: 1px solid transparent; color: var(--spice-text, #fff); font-weight: 700; font-size: 15px; padding: 2px 0; min-width: 0; flex: 1; }
      .sai-groupname:hover, .sai-groupname:focus { border-bottom-color: rgba(var(--spice-rgb-text, 255,255,255),.35); outline: none; }
      @media (prefers-reduced-motion: reduce) { .sai-card, .sai-in { animation: none !important; } .sai-card:hover { transform: none; } }
      .sai-send { cursor: pointer; width: 36px; height: 36px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; background: var(--spice-button, #1ed760); color: var(--sai-on-accent, #000); transition: transform .12s, opacity .15s; flex: none; }
      .sai-send:hover:not(:disabled) { transform: scale(1.06); }
      .sai-send:disabled { opacity: .35; cursor: default; }
      .sai-tile { cursor: pointer; padding: 12px; border-radius: 8px; transition: background .15s; min-width: 0; }
      .sai-tile:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.08); }
      .sai-tile .cover { width: 100%; aspect-ratio: 1; border-radius: 6px; object-fit: cover; background: rgba(var(--spice-rgb-text, 255,255,255),.07); display: flex; align-items: center; justify-content: center; color: var(--spice-subtext, #b3b3b3); box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      .sai-tile .name { font-weight: 700; margin-top: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sai-adv summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; color: var(--spice-subtext, #b3b3b3); font-size: 13px; }
      .sai-adv summary::-webkit-details-marker { display: none; }
      .sai-adv summary svg { transition: transform .15s; }
      .sai-adv[open] summary svg { transform: rotate(90deg); }
      .sai-cover { position: relative; width: 40px; height: 40px; border-radius: 4px; overflow: hidden; flex: none; cursor: pointer; background: rgba(var(--spice-rgb-text, 255,255,255),.07); display: flex; align-items: center; justify-content: center; color: var(--spice-subtext, #b3b3b3); }
      .sai-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .sai-cover .play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); color: #fff; opacity: 0; transition: opacity .12s; }
      .sai-trackrow:hover .sai-cover .play, .sai-cover.on .play { opacity: 1; }
      .sai-cover.on .play { color: var(--spice-button, #1ed760); }
      .sai-trackrow { display: flex; align-items: center; gap: 12px; padding: 6px 8px; border-radius: 6px; transition: background .12s; }
      .sai-trackrow:hover { background: rgba(var(--spice-rgb-text, 255,255,255),.06); }
      .sai-trackrow .title { cursor: pointer; }
      .sai-trackrow .title:hover { text-decoration: underline; }
      .sai-composer:focus-within { border-color: rgba(var(--spice-rgb-text, 255,255,255),.35) !important; }
      .sai-composer input { outline: none; }
    `}</style>
  );
}

type IconName = "copy" | "globe" | "split" | "funnel" | "compass" | "stop" | "play" | "pause" | "settings" | "back" | "check" | "cross" | "send" | "spark" | "plus" | "chevron" | "lock" | "music" | "heart" | "palette";

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  let body;
  switch (name) {
    case "settings":
      // A cog drawn with thin lines, like Spotify's own icons.
      body = (
        <g {...stroke} strokeWidth={1.7}>
          <path d="M9.90 5.22L10.47 2.52L13.53 2.52L14.10 5.22L15.31 5.72L17.62 4.22L19.78 6.38L18.28 8.69L18.78 9.90L21.48 10.47L21.48 13.53L18.78 14.10L18.28 15.31L19.78 17.62L17.62 19.78L15.31 18.28L14.10 18.78L13.53 21.48L10.47 21.48L9.90 18.78L8.69 18.28L6.38 19.78L4.22 17.62L5.72 15.31L5.22 14.10L2.52 13.53L2.52 10.47L5.22 9.90L5.72 8.69L4.22 6.38L6.38 4.22L8.69 5.72Z" />
          <circle cx="12" cy="12" r="3" />
        </g>
      );
      break;
    case "back": body = <path d="M15 5l-7 7 7 7" {...stroke} />; break;
    case "check": body = <path d="M5 12.5l4.5 4.5L19 7.5" {...stroke} strokeWidth={2.4} />; break;
    case "cross": body = <path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth={2.4} />; break;
    case "send": body = <path d="M12 19V5M5.500 11.500L12 5l6.500 6.500" {...stroke} strokeWidth={2.4} />; break;
    case "copy": body = <g {...stroke} strokeWidth={1.8}><rect x="8.500" y="8.500" width="11" height="11" rx="2.500" /><path d="M15.500 5.500v-.5a2 2 0 0 0-2-2H6.500a2 2 0 0 0-2 2v6.500a2 2 0 0 0 2 2h.5" /></g>; break;
    case "globe": body = <g {...stroke} strokeWidth={1.8}><circle cx="12" cy="12" r="8.500" /><path d="M3.500 12h17M12 3.500c2.600 2.400 3.800 5.200 3.800 8.500s-1.200 6.100-3.800 8.500c-2.600-2.400-3.800-5.200-3.800-8.500S9.400 5.900 12 3.500z" /></g>; break;
    case "split": body = <g {...stroke} strokeWidth={1.8}><path d="M12 3.500v6.500M12 10c0 3-6 3-6 7v3.500M12 10c0 3 6 3 6 7v3.500" /><path d="M3.500 18L6 20.500 8.500 18M15.500 18l2.500 2.500 2.500-2.500" /></g>; break;
    case "funnel": body = <path {...stroke} strokeWidth={1.8} d="M4 5h16l-6.200 7.400V18l-3.600 2v-7.600L4 5z" />; break;
    case "compass": body = <g {...stroke} strokeWidth={1.8}><circle cx="12" cy="12" r="8.500" /><path d="M15.300 8.700l-1.900 4.700-4.700 1.900 1.900-4.700 4.700-1.900z" /></g>; break;
    case "stop": body = <rect x="6.500" y="6.500" width="11" height="11" rx="2" fill="currentColor" />; break;
    case "play": body = <path fill="currentColor" d="M8 5.500v13a.6.6 0 0 0 .92.500l10-6.500a.6.6 0 0 0 0-1l-10-6.500A.6.6 0 0 0 8 5.500z" />; break;
    case "pause": body = <g fill="currentColor"><rect x="6.500" y="5" width="4" height="14" rx="1" /><rect x="13.500" y="5" width="4" height="14" rx="1" /></g>; break;
    case "heart": body = <path d="M12 20s-7.500-4.700-7.500-10.200A4.300 4.300 0 0 1 12 7.300a4.300 4.300 0 0 1 7.500 2.500C19.500 15.300 12 20 12 20z" {...stroke} />; break;
    case "palette": body = <g {...stroke}><path d="M12 3.500a8.500 8.500 0 1 0 0 17c1.300 0 2-.900 2-1.900 0-1.300-1-1.600-1-2.600 0-.900.700-1.500 1.600-1.500h2.200a3.700 3.700 0 0 0 3.700-3.700C20.500 6.700 16.700 3.500 12 3.500z" /><circle cx="8" cy="11" r="1" /><circle cx="11" cy="7.500" r="1" /><circle cx="15.500" cy="8.500" r="1" /></g>; break;
    case "plus": body = <path d="M12 5v14M5 12h14" {...stroke} />; break;
    case "chevron": body = <path d="M9 6l6 6-6 6" {...stroke} />; break;
    case "lock": body = <g {...stroke} strokeWidth={1.8}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></g>; break;
    case "music": body = <g {...stroke} strokeWidth={1.8}><path d="M9 18V6l10-2v12" /><circle cx="6.500" cy="18" r="2.500" /><circle cx="16.500" cy="16" r="2.500" /></g>; break;
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

// --- what Spotify is playing right now, shared by every track row on the page.
// Listeners on the player exist only while at least one row is on screen.

const rows = new Set<() => void>();
const notifyRows = () => rows.forEach((refresh) => refresh());
const PLAYER_EVENTS = ["songchange", "onplaypause"];

function watchPlayer(refresh: () => void): () => void {
  if (rows.size === 0) PLAYER_EVENTS.forEach((e) => Spicetify.Player?.addEventListener?.(e, notifyRows));
  rows.add(refresh);
  return () => {
    rows.delete(refresh);
    if (rows.size === 0) PLAYER_EVENTS.forEach((e) => Spicetify.Player?.removeEventListener?.(e, notifyRows));
  };
}

const currentUri = (): string => Spicetify.Player?.data?.item?.uri ?? "";
const isPlaying = (): boolean => !!Spicetify.Player?.isPlaying?.();

/**
 * One track in a list: optional checkbox, cover, title, a second line, and
 * something on the right. Clicking the cover or the title plays the track in
 * Spotify; clicking it again pauses. The icon follows the real player state.
 */
export function TrackRow(props: {
  uri: string; name: string; imageUrl: string; local?: boolean;
  sub: any; right?: any; badges?: any;
  checked?: boolean; onToggle?: () => void;
  onPlay: (uri: string) => Promise<void>;
  key?: string;
}) {
  const { useEffect, useState } = hooks();
  const [, refresh] = useState(0);
  useEffect(() => watchPlayer(() => refresh(Math.random())) as unknown as void, []);

  const current = currentUri() === props.uri;
  const playing = current && isPlaying();
  const click = () => {
    if (props.local) return;
    if (current) Spicetify.Player?.togglePlay?.();
    else props.onPlay(props.uri).catch(() => {});
  };
  return (
    <div className="sai-trackrow">
      {props.onToggle && <input type="checkbox" checked={!!props.checked} onChange={props.onToggle} style={{ flex: "none", cursor: "pointer" }} />}
      <div className={current ? "sai-cover on" : "sai-cover"} onClick={click} title={props.local ? "" : playing ? t("pause") : t("play")}>
        {props.imageUrl ? <img src={props.imageUrl} loading="lazy" alt="" /> : <Icon name="music" size={18} />}
        {!props.local && <span className="play"><Icon name={playing ? "pause" : "play"} size={18} /></span>}
      </div>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="title" onClick={click} style={current ? { color: "var(--spice-button, #1ed760)" } : undefined}>{props.name}</span>
        {props.badges}
        <div style={css.muted}>{props.sub}</div>
      </span>
      {props.right !== undefined && <span style={{ ...css.muted, flex: "none" }}>{props.right}</span>}
    </div>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  return <div className="sai-bar"><div style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} /></div>;
}
