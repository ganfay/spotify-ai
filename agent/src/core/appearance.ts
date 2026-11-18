// The saved look of Spotify, shared by the startup extension (which applies it)
// and the app's Appearance page (which edits it). No imports: this file ends up
// in the code that runs every time Spotify starts, so it must stay tiny.

export const APPEARANCE_KEY = "spotify-ai:appearance";

/** Spicetify's colour names (Themes/spotify-ai/color.ini lists the stock values). */
export type ColorName =
  | "text" | "subtext" | "main" | "main-elevated" | "highlight" | "highlight-elevated" | "sidebar" | "player" | "card"
  | "shadow" | "selected-row" | "button" | "button-active" | "button-disabled" | "tab-active" | "notification"
  | "notification-error" | "misc";

export interface Appearance {
  /** Colours that differ from stock, as RRGGBB without "#". */
  colors?: Partial<Record<ColorName, string>>;
  /** A background gradient over the whole window: 2–3 colours (RRGGBB), an angle in degrees, strength 0–1. */
  gradient?: { colors: string[]; angle: number; intensity: number };
  /** A full theme (extra styles in user.css are switched on by this name). */
  theme?: string;
}

export function loadAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    return raw ? (JSON.parse(raw) as Appearance) : null;
  } catch {
    return null;
  }
}

const HEX = /^[0-9a-fA-F]{6}$/;

/** Puts a look on the page, or removes ours completely when given null. */
export function applyAppearance(look: Appearance | null): void {
  const root = document.documentElement;
  // Remove whatever an earlier call set.
  for (const name of Array.from(root.style)) {
    if (name.startsWith("--spice-") || name.startsWith("--sai-")) root.style.removeProperty(name);
  }
  root.removeAttribute("data-sai-theme");
  root.removeAttribute("data-sai-gradient");
  if (!look) return;

  for (const [name, hex] of Object.entries(look.colors ?? {})) {
    if (!hex || !HEX.test(hex)) continue;
    root.style.setProperty(`--spice-${name}`, `#${hex}`);
    root.style.setProperty(`--spice-rgb-${name}`, [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(","));
  }
  const gradient = look.gradient;
  if (gradient && gradient.colors.length >= 2 && gradient.colors.every((c) => HEX.test(c))) {
    root.style.setProperty("--sai-gradient", `linear-gradient(${Number(gradient.angle) || 0}deg, ${gradient.colors.map((c) => `#${c}`).join(", ")})`);
    root.style.setProperty("--sai-gradient-strength", String(Math.max(0, Math.min(1, Number(gradient.intensity) || 0))));
    root.setAttribute("data-sai-gradient", "on");
  }
  if (look.theme && /^[a-z0-9-]{1,30}$/.test(look.theme)) root.setAttribute("data-sai-theme", look.theme);
}
