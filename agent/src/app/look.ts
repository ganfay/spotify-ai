// Turns two choices (a background and an accent colour) into the full set of
// colours Spotify uses, and holds the ready-made looks.

import type { Appearance, ColorName } from "../core/appearance";

export type Rgb = [number, number, number];

export const toRgb = (hex: string): Rgb => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
export const toHex = (rgb: Rgb): string => rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
/** amount 0 = a, 1 = b. */
export const mix = (a: string, b: string, amount: number): string => {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * amount) as Rgb);
};

/** Perceived brightness, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

export function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return toHex([f(0), f(8), f(4)]);
}
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * The full palette from a background and an accent. Works for dark and light
 * backgrounds: the text colour and the "one step lighter" direction follow the background.
 */
export function buildColors(background: string, accent: string): Record<ColorName, string> {
  const dark = luminance(background) < 0.4;
  const text = dark ? "ffffff" : "121212";
  const toward = dark ? "ffffff" : "000000"; // raised surfaces go this way
  const away = dark ? "000000" : "ffffff";
  const step = (amount: number) => mix(background, toward, amount);
  // An accent too close to the background would make buttons disappear.
  const button = contrast(accent, background) < 1.8 ? mix(accent, toward, 0.45) : accent;
  return {
    text,
    subtext: mix(text, background, 0.32),
    main: background,
    "main-elevated": step(0.08),
    highlight: step(0.05),
    "highlight-elevated": step(0.12),
    sidebar: mix(background, away, dark ? 0.45 : 0.25),
    player: step(0.03),
    card: step(0.1),
    shadow: dark ? "000000" : mix(background, "000000", 0.35),
    "selected-row": text,
    button,
    "button-active": mix(button, toward, 0.18),
    "button-disabled": mix(text, background, 0.68),
    "tab-active": step(0.16),
    notification: button,
    "notification-error": "e22134",
    misc: mix(text, background, 0.5),
  };
}

export interface Choice {
  background: string;
  accent: string;
  gradient: { colors: string[]; angle: number; intensity: number } | null;
  preset?: string;
}

export const toAppearance = (choice: Choice): Appearance => ({
  colors: buildColors(choice.background, choice.accent),
  ...(choice.gradient ? { gradient: choice.gradient } : {}),
  base: { background: choice.background, accent: choice.accent, ...(choice.preset ? { preset: choice.preset } : {}) },
});

/** Spotify's own colours: the starting point of "your own" look. */
export const STOCK: Choice = { background: "121212", accent: "1db954", gradient: null };

export const fromAppearance = (look: Appearance | null): Choice =>
  look?.base
    ? { background: look.base.background, accent: look.base.accent, gradient: look.gradient ?? null, ...(look.base.preset ? { preset: look.base.preset } : {}) }
    : { ...STOCK };

export interface Preset extends Choice {
  preset: string;
  /** A proper name, the same in every language. */
  name: string;
}
const preset = (id: string, name: string, background: string, accent: string, gradient?: [string[], number, number]): Preset => ({
  preset: id, name, background, accent, gradient: gradient ? { colors: gradient[0], angle: gradient[1], intensity: gradient[2] } : null,
});
export const PRESETS: Preset[] = [
  preset("violet", "Violet Night", "0e0a14", "b45cff", [["8f34a5", "1b1f6b", "0b0b1e"], 160, 0.6]),
  preset("vice", "Vice", "140a1e", "ff4fa3", [["ff5f9e", "6a3df0", "14c8d4"], 135, 0.55]),
  preset("ocean", "Ocean", "07131c", "2ec4ff", [["0b5c9e", "0a2540", "06121d"], 180, 0.6]),
  preset("sunset", "Sunset", "1a0c0a", "ff8a3d", [["ff6a3d", "b0306a", "2a0f3a"], 200, 0.55]),
  preset("forest", "Forest", "0a140e", "4ade80", [["1b6b3a", "0b2a1e", "07130d"], 170, 0.55]),
  preset("rose", "Rose", "180d12", "ff7aa8", [["8a2c52", "2a1020"], 150, 0.5]),
  preset("ember", "Ember", "140a08", "ff5a36", [["7a1f12", "1a0a08"], 180, 0.5]),
  preset("graphite", "Graphite", "16181c", "9fb3c8"),
  preset("mono", "Mono", "000000", "ffffff"),
];

/** A full theme: its own colours plus styles in agent/theme/user.css that restyle Spotify. */
export interface Theme {
  id: string;
  /** A proper name, the same in every language. */
  name: string;
  background: string;
  accent: string;
  /** Colours that differ from what the two base colours would give. */
  colors?: Partial<Record<ColorName, string>>;
  cover?: boolean;
}
export const THEMES: Theme[] = [
  { id: "glass", name: "Glass", background: "12121a", accent: "ffffff", colors: { subtext: "cfcfdc", "main-elevated": "2a2a3a" }, cover: true },
];
/** The preset name stored for a theme, so the page can show which one is on. */
export const themeMark = (id: string): string => `theme:${id}`;

export const themeAppearance = (theme: Theme): Appearance => ({
  colors: { ...buildColors(theme.background, theme.accent), ...theme.colors },
  theme: theme.id,
  ...(theme.cover ? { cover: true } : {}),
  base: { background: theme.background, accent: theme.accent, preset: themeMark(theme.id) },
});
