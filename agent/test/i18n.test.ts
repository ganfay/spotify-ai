// Every language must have every text, with the same {placeholders}.
import assert from "node:assert/strict";
import { test } from "node:test";
import { count, KEYS, LANGUAGES, setLanguage, t } from "../src/app/i18n";
import { type CoreLang, detectCoreLang, SHUFFLE_TEXTS } from "../src/core/shuffle-texts";

// Words that are legitimately the same in several languages.
const SAME_OK = /^(tag\.|play$|pause$|set\.optional$)/;

const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

test("all four languages have EVERY text, with matching placeholders", () => {
  assert.ok(KEYS.length > 150);
  for (const key of KEYS) {
    setLanguage("en");
    const source = t(key);
    assert.notEqual(source, key, `missing in English: ${key}`);
    for (const { id } of LANGUAGES.filter((l) => l.id !== "en")) {
      setLanguage(id);
      const text = t(key);
      assert.equal(holes(text), holes(source), `${id} placeholders differ for ${key}`);
      if (!SAME_OK.test(key)) assert.notEqual(text, source, `${id} is not translated: ${key}`);
    }
  }
});

test("plural forms", () => {
  setLanguage("en");
  assert.deepEqual([1, 2, 5].map((n) => count(n, "track")), ["1 track", "2 tracks", "5 tracks"]);
  setLanguage("uk");
  assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map((n) => count(n, "track")), ["1 трек", "2 треки", "5 треків", "11 треків", "21 трек", "22 треки", "112 треків"]);
  assert.equal(count(3, "playlist"), "3 плейлисти");
  setLanguage("ru");
  assert.deepEqual([1, 3, 7, 14].map((n) => count(n, "group")), ["1 группа", "3 группы", "7 групп", "14 групп"]);
  setLanguage("de");
  assert.deepEqual([1, 4].map((n) => count(n, "playlist")), ["1 Playlist", "4 Playlists"]);
  setLanguage("en");
});

test("variables are filled in", () => {
  setLanguage("uk");
  assert.equal(t("dup.title", { name: "Mix" }), "Дублікати в «Mix»");
  setLanguage("en");
});

test("SHUFFLE_TEXTS matches app i18n shuffle.* keys in all four languages", () => {
  try {
    const langs: CoreLang[] = ["en", "uk", "ru", "de"];
    for (const lang of langs) {
      setLanguage(lang);
      assert.equal(t("shuffle.off"), SHUFFLE_TEXTS[lang].off);
      assert.equal(t("shuffle.spotify"), SHUFFLE_TEXTS[lang].spotify);
      assert.equal(t("shuffle.true"), SHUFFLE_TEXTS[lang].trueShuffle);
      assert.equal(t("shuffle.smart"), SHUFFLE_TEXTS[lang].smartShuffle);
      assert.equal(t("shuffle.unavailable"), SHUFFLE_TEXTS[lang].unavailable);
    }
  } finally {
    setLanguage("en");
  }
});

test("detectCoreLang reads settings override and falls back safely", () => {
  const g = globalThis as Record<string, unknown>;
  const origSpicetifyDesc = Object.getOwnPropertyDescriptor(g, "Spicetify");
  const origNavigatorDesc = Object.getOwnPropertyDescriptor(g, "navigator");

  const setGlobalProp = (name: string, value: unknown) => {
    Object.defineProperty(g, name, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  };

  const restoreGlobalProp = (name: string, desc: PropertyDescriptor | undefined) => {
    if (desc) {
      Object.defineProperty(g, name, desc);
    } else {
      delete g[name];
    }
  };

  try {
    setGlobalProp("Spicetify", { Locale: { getLocale: () => "uk-UA" } });
    setGlobalProp("navigator", { language: "de-DE" });

    assert.equal(
      detectCoreLang({ getItem: () => JSON.stringify({ language: "ru" }) }),
      "ru",
    );
    assert.equal(
      detectCoreLang({ getItem: () => JSON.stringify({ language: "DE-AT" }) }),
      "de",
    );
    // "auto" falls through to Spicetify.Locale.getLocale()
    assert.equal(
      detectCoreLang({ getItem: () => JSON.stringify({ language: "auto" }) }),
      "uk",
    );
    // Corrupt JSON or throwing storage falls through cleanly
    assert.equal(detectCoreLang({ getItem: () => "{broken" }), "uk");
    assert.equal(
      detectCoreLang({
        getItem: () => {
          throw new Error("denied");
        },
      }),
      "uk",
    );

    // Fallback chain: Locale -> Platform.Session.locale -> navigator.language -> "en"
    setGlobalProp("Spicetify", {
      Locale: { getLocale: () => "" },
      Platform: { Session: { locale: "ru-RU" } },
    });
    assert.equal(detectCoreLang({ getItem: () => null }), "ru");

    setGlobalProp("Spicetify", undefined);
    assert.equal(detectCoreLang({ getItem: () => null }), "de");

    setGlobalProp("navigator", { language: "fr-FR" });
    assert.equal(detectCoreLang({ getItem: () => null }), "en");

    setGlobalProp("navigator", undefined);
    assert.equal(detectCoreLang(), "en");
  } finally {
    restoreGlobalProp("Spicetify", origSpicetifyDesc);
    restoreGlobalProp("navigator", origNavigatorDesc);
  }
});
