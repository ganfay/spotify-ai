// The saved look of Spotify, shared by the startup extension (which applies it)
// and the app's Appearance page (which edits it). No imports: this file ends up
// in the code that runs every time Spotify starts, so it must stay tiny.

export const APPEARANCE_KEY = "spotify-ai:appearance";
/** The user's own background picture (a data URL), kept apart so the look itself stays small. */
export const PHOTO_KEY = "spotify-ai:photo";

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
  /** The theme uses the cover of the playing song as its backdrop. */
  cover?: boolean;
  /** Show the user's own picture (PHOTO_KEY) behind the panels; strength 0–1 = how much of it shows. */
  photo?: { strength: number };
  /** What the Appearance page built the colours from, so it can be edited again. */
  base?: { background: string; accent: string; preset?: string };
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

/** Stops following the playing song's cover (set while a theme that uses it is on). */
let stopCover: (() => void) | null = null;

/** Keeps --sai-cover pointing at the cover of the playing song. Runs only for themes that ask for it. */
function followCover(root: HTMLElement): () => void {
  const player = () => (window as unknown as { Spicetify?: any }).Spicetify?.Player;
  const set = () => {
    const meta = player()?.data?.item?.metadata;
    const raw: unknown = meta?.image_xlarge_url || meta?.image_url;
    if (typeof raw !== "string" || !raw) return;
    const url = raw.startsWith("http") ? raw : `https://i.scdn.co/image/${raw.split(":").pop()}`;
    if (/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9/_.-]+$/.test(url)) root.style.setProperty("--sai-cover", `url(${url})`);
  };
  // Spotify's player object appears a moment after start.
  let tries = 0;
  const timer = setInterval(() => {
    if (player()?.addEventListener) {
      clearInterval(timer);
      player().addEventListener("songchange", set);
      set();
    } else if (++tries > 120) clearInterval(timer);
  }, 500);
  return () => {
    clearInterval(timer);
    player()?.removeEventListener?.("songchange", set);
  };
}

/** Puts a look on the page, or removes ours completely when given null. */
export function applyAppearance(look: Appearance | null): void {
  const root = document.documentElement;
  stopCover?.();
  stopCover = null;
  // Remove whatever an earlier call set.
  for (const name of Array.from(root.style)) {
    if (name.startsWith("--spice-") || name.startsWith("--sai-")) root.style.removeProperty(name);
  }
  root.removeAttribute("data-sai-theme");
  root.removeAttribute("data-sai-gradient");
  root.removeAttribute("data-sai-look");
  root.removeAttribute("data-sai-photo");
  if (!look) return;
  root.setAttribute("data-sai-look", "on");

  for (const [name, hex] of Object.entries(look.colors ?? {})) {
    if (!hex || !HEX.test(hex)) continue;
    root.style.setProperty(`--spice-${name}`, `#${hex}`);
    root.style.setProperty(`--spice-rgb-${name}`, [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(","));
  }
  // Text and icons drawn ON the accent colour: black on a bright accent, white on a dark one.
  const accent = look.colors?.button;
  if (accent && HEX.test(accent)) {
    const lum = [0, 2, 4].reduce((sum, i, k) => sum + [0.2126, 0.7152, 0.0722][k]! * (parseInt(accent.slice(i, i + 2), 16) / 255) ** 2.2, 0);
    root.style.setProperty("--sai-on-accent", lum > 0.18 ? "#000" : "#fff");
  }
  const gradient = look.gradient;
  if (gradient && gradient.colors.length >= 2 && gradient.colors.every((c) => HEX.test(c))) {
    const strength = Math.max(0, Math.min(1, Number(gradient.intensity) || 0));
    root.style.setProperty("--sai-gradient", `linear-gradient(${Number(gradient.angle) || 0}deg, ${gradient.colors.map((c) => `#${c}`).join(", ")})`);
    // The gradient is painted behind everything and the big panels become see-through
    // (both in user.css). The colours stay solid: Spotify also uses them for icons
    // and for the fade of long titles. The stronger the gradient, the thinner the panels.
    root.style.setProperty("--sai-panel", Math.max(0.2, 1 - strength * 0.8).toFixed(2));
    root.setAttribute("data-sai-gradient", "on");
  }
  // The user's own picture. In a theme it takes the place of the playing song's cover;
  // otherwise it is the backdrop, and the panels become see-through as with a gradient.
  let photo: string | null = null;
  if (look.photo) {
    try { photo = localStorage.getItem(PHOTO_KEY); } catch { photo = null; }
  }
  if (photo && photo.startsWith("data:image/") && !/["'()\\\s]/.test(photo)) {
    root.style.setProperty("--sai-cover", `url(${photo})`);
    root.setAttribute("data-sai-photo", "on");
    if (!gradient) {
      const strength = Math.max(0, Math.min(1, Number(look.photo!.strength) || 0));
      root.style.setProperty("--sai-panel", Math.max(0.2, 1 - strength * 0.8).toFixed(2));
    }
  } else photo = null;
  if (look.theme && /^[a-z0-9-]{1,30}$/.test(look.theme)) {
    root.setAttribute("data-sai-theme", look.theme);
    if (look.cover && !photo) stopCover = followCover(root);
  }
}
