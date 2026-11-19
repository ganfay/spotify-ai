// Dependency-free 4-language strings and locale detection for True Shuffle.
// Imported by both startup core (spotify-ai-core.js) and app/i18n.ts.

export type CoreLang = "en" | "uk" | "ru" | "de";

export interface ShuffleTextSet {
  off: string;
  spotify: string;
  trueShuffle: string;
  smartShuffle: string;
  unavailable: string;
}

const CORE_LANGS: readonly CoreLang[] = ["en", "uk", "ru", "de"];
const SETTINGS_KEY = "spotify-ai:settings";

export const SHUFFLE_TEXTS: Record<CoreLang, ShuffleTextSet> = {
  en: {
    off: "Shuffle: off",
    spotify: "Shuffle: Spotify",
    trueShuffle: "True Shuffle (no repeats)",
    smartShuffle: "Smart Shuffle",
    unavailable: "Shuffle unavailable",
  },
  uk: {
    off: "Перемішування: вимкнено",
    spotify: "Перемішування: Spotify",
    trueShuffle: "True Shuffle (без повторів)",
    smartShuffle: "Розумне перемішування",
    unavailable: "Перемішування недоступне",
  },
  ru: {
    off: "Перемешивание: выключено",
    spotify: "Перемешивание: Spotify",
    trueShuffle: "True Shuffle (без повторов)",
    smartShuffle: "Умное перемешивание",
    unavailable: "Перемешивание недоступно",
  },
  de: {
    off: "Zufallswiedergabe: aus",
    spotify: "Zufallswiedergabe: Spotify",
    trueShuffle: "True Shuffle (ohne Wiederholungen)",
    smartShuffle: "Smarte Zufallswiedergabe",
    unavailable: "Zufallswiedergabe nicht verfügbar",
  },
};

function normalizeLang(raw: unknown): CoreLang | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().slice(0, 2).toLowerCase();
  return CORE_LANGS.find((l) => l === code) ?? null;
}

export function detectCoreLang(storage?: Pick<Storage, "getItem">): CoreLang {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    const raw = store?.getItem?.(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { language?: unknown } | null;
      if (parsed && typeof parsed === "object") {
        const override = normalizeLang(parsed.language);
        if (override) return override;
      }
    }
  } catch {
    // Ignore storage access errors or malformed JSON.
  }

  const g = globalThis as { Spicetify?: any; navigator?: { language?: string } };
  const locale =
    g.Spicetify?.Locale?.getLocale?.() ||
    g.Spicetify?.Platform?.Session?.locale ||
    g.navigator?.language ||
    "en";
  return normalizeLang(locale) ?? "en";
}
