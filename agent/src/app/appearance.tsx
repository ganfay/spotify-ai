// The Appearance page: ready-made looks, your own colours, a gradient. Every
// change is shown at once and saved; the small startup extension applies the
// saved look when Spotify starts (src/core).

import { type Appearance, APPEARANCE_KEY, applyAppearance, loadAppearance, PHOTO_KEY } from "../core/appearance";
import { t } from "./i18n";
import { type Choice, fromAppearance, hexToHsl, hslToHex, PRESETS, STOCK, type Theme, themeAppearance, themeMark, THEMES, toAppearance } from "./look";
import type { Key } from "./i18n";
import { BackLink, css, hooks, Icon } from "./ui";

declare const Spicetify: any;

// The startup extension's own function when it is there: it remembers what it switched
// on (the cover follower of Glass), so only it can switch that off again.
const apply: typeof applyAppearance = (window as unknown as { __spotifyAiAppearance?: typeof applyAppearance }).__spotifyAiAppearance ?? applyAppearance;

const HEX = /^[0-9a-fA-F]{6}$/;
const section = { ...css.muted, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, fontSize: 11, margin: "26px 0 10px" } as const;
const row = { display: "flex", alignItems: "center", gap: 12, margin: "10px 0" } as const;
const labelStyle = { width: 130, flex: "none", fontSize: 14, fontWeight: 700 } as const;

/** Whether this Spotify was set up for looks (colour replacement on, startup extension present). */
export function looksReady(): boolean {
  const colours = getComputedStyle(document.documentElement).getPropertyValue("--spice-main").trim() !== "";
  const extension = (Spicetify?.Config?.extensions ?? []).includes("spotify-ai-core.js");
  return colours && extension;
}

function Slider({ value, min, max, onChange, background }: { value: number; min: number; max: number; onChange: (v: number) => void; background?: string }) {
  return (
    <input type="range" className="sai-range" min={min} max={max} value={value}
           style={background ? { background } : undefined}
           onChange={(e: any) => onChange(Number(e.target.value))} />
  );
}

/** A colour: a swatch and its code; a click opens three sliders. */
function ColorField({ value, onChange, onRemove }: { value: string; onChange: (hex: string) => void; onRemove?: () => void; key?: string }) {
  const { useState } = hooks();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [h, s, l] = hexToHsl(value);
  const set = (hex: string) => {
    setText(hex);
    onChange(hex);
  };
  const typed = (raw: string) => {
    const clean = raw.replace(/^#/, "").trim();
    setText(clean);
    if (HEX.test(clean)) onChange(clean.toLowerCase());
  };
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="sai-swatch" style={{ background: `#${value}` }} onClick={() => setOpen(!open)} title={`#${value}`} />
        <input className="sai-hex" value={text === value || !HEX.test(text) ? text : value} maxLength={7} spellCheck={false}
               onChange={(e: any) => typed(e.target.value)} onBlur={() => setText(value)} />
        {onRemove && <span className="sai-link" title={t("look.removeColor")} onClick={onRemove}><Icon name="cross" size={12} /></span>}
      </div>
      {open && (
        <div className="sai-in" style={{ margin: "10px 0 4px", display: "grid", gap: 8, maxWidth: 320 }}>
          <Slider value={h} min={0} max={360} onChange={(v) => set(hslToHex(v, s, l))}
                  background="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" />
          <Slider value={s} min={0} max={100} onChange={(v) => set(hslToHex(h, v, l))}
                  background={`linear-gradient(90deg,#${hslToHex(h, 0, l)},#${hslToHex(h, 100, l)})`} />
          <Slider value={l} min={0} max={100} onChange={(v) => set(hslToHex(h, s, v))}
                  background={`linear-gradient(90deg,#000,#${hslToHex(h, s, 50)},#fff)`} />
        </div>
      )}
    </div>
  );
}

const MAX_PHOTO_CHARS = 1_400_000; // local storage is shared with Spotify: keep the picture small

/** Reads a picture file, shrinks it to at most 1600 px on the long side and returns it as a JPEG data URL. */
async function shrinkPicture(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.84, 0.72, 0.6, 0.48]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_PHOTO_CHARS) return url;
  }
  throw new Error("too big");
}

const preview = (c: Choice): string =>
  c.gradient ? `linear-gradient(${c.gradient.angle}deg, ${c.gradient.colors.map((x) => `#${x}`).join(", ")})` : `#${c.background}`;

export function AppearanceView({ onBack }: { onBack: () => void }) {
  const { useState } = hooks();
  const [saved, setSaved] = useState(() => loadAppearance() !== null);
  const [choice, setChoice] = useState(() => fromAppearance(loadAppearance()));
  const [works] = useState(looksReady);
  // The own picture: kept apart from the colours, so it stays when a preset or theme is picked.
  const [photo, setPhoto] = useState(() => { try { return localStorage.getItem(PHOTO_KEY); } catch { return null; } });
  const [photoSet, setPhotoSet] = useState(() => loadAppearance()?.photo ?? null);
  const [photoError, setPhotoError] = useState("");
  /** Saves and shows a look, with the picture setting added. */
  const save = (look: Appearance | null, picture: Appearance["photo"] | null | undefined = photoSet) => {
    const full = look ?? (picture ? { colors: {}, photo: picture } : null);
    if (full && picture) full.photo = picture; else if (full) delete full.photo;
    if (full) localStorage.setItem(APPEARANCE_KEY, JSON.stringify(full)); else localStorage.removeItem(APPEARANCE_KEY);
    apply(full);
  };

  const use = (next: Choice | null) => {
    if (next === null) {
      save(null);
      setChoice({ ...STOCK });
      setSaved(false);
      return;
    }
    save(toAppearance(next));
    setChoice(next);
    setSaved(true);
  };
  const useTheme = (theme: Theme) => {
    save(themeAppearance(theme));
    setChoice({ background: theme.background, accent: theme.accent, gradient: null, preset: themeMark(theme.id) });
    setSaved(true);
  };
  /** A change made by hand is no longer "the preset". */
  const edit = (patch: Partial<Choice>) => {
    const { preset: _preset, ...rest } = { ...choice, ...patch };
    use(rest);
  };
  /** The current look again, with a new picture setting. */
  const repaint = (picture: Appearance["photo"] | null | undefined) => {
    setPhotoSet(picture ?? null);
    const current = loadAppearance();
    const base = current && Object.keys(current.colors ?? {}).length ? current : null;
    save(base, picture);
  };
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError("");
    try {
      const url = await shrinkPicture(file);
      localStorage.setItem(PHOTO_KEY, url);
      setPhoto(url);
      repaint(photoSet ?? { strength: 0.55 });
    } catch {
      setPhotoError(t("look.photoTooBig"));
    }
  };
  const removePhoto = () => {
    try { localStorage.removeItem(PHOTO_KEY); } catch { /* ignore */ }
    setPhoto(null);
    repaint(null);
  };
  const gradient = choice.gradient;
  const setGradient = (patch: Partial<NonNullable<Choice["gradient"]>>) => gradient && edit({ gradient: { ...gradient, ...patch } });

  return (
    <div style={{ ...css.column, marginTop: 20, maxWidth: 640 }}>
      <BackLink label={t("back.tools")} onClick={onBack} />
      <h2 style={{ fontSize: 20, margin: "6px 0 4px" }}>{t("f.look.title")}</h2>
      <p style={{ ...css.muted, margin: 0 }}>{t("look.note")}</p>
      {!works && <p style={{ ...css.notice, marginTop: 16 }}>{t("look.missing")}</p>}

      <div style={section}>{t("look.presets")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10 }}>
        <div className={`sai-look${saved ? "" : " on"}`} onClick={() => use(null)}>
          <div className="pic" style={{ background: "#121212" }}><span className="dot" style={{ background: "#1db954" }} /></div>
          <div className="name">Spotify</div>
        </div>
        {PRESETS.map((p) => (
          <div key={p.preset} className={`sai-look${saved && choice.preset === p.preset ? " on" : ""}`} onClick={() => use(p)}>
            <div className="pic" style={{ background: preview(p) }}><span className="dot" style={{ background: `#${p.accent}` }} /></div>
            <div className="name">{p.name}</div>
          </div>
        ))}
      </div>

      <div style={section}>{t("look.exclusive")} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{t("look.fps")}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {THEMES.map((theme) => (
          <div key={theme.id} className={`sai-look sai-theme${saved && choice.preset === themeMark(theme.id) ? " on" : ""}`} onClick={() => useTheme(theme)}>
            <div className={`pic sai-theme-${theme.id}`}><span className="word">{theme.name}</span></div>
            <div className="name">{theme.name}</div>
            <div style={{ ...css.muted, fontSize: 12, padding: "0 2px 4px", lineHeight: 1.35 }}>{t(`look.theme.${theme.id}` as Key)}</div>
          </div>
        ))}
      </div>

      <div style={section}>{t("look.custom")}</div>
      <div style={row}><div style={labelStyle}>{t("look.accent")}</div><ColorField key={`a${choice.preset ?? ""}`} value={choice.accent} onChange={(hex) => edit({ accent: hex })} /></div>
      <div style={row}><div style={labelStyle}>{t("look.background")}</div><ColorField key={`b${choice.preset ?? ""}`} value={choice.background} onChange={(hex) => edit({ background: hex })} /></div>

      <div style={section}>{t("look.gradient")}</div>
      <label style={{ ...row, cursor: "pointer" }}>
        <input type="checkbox" style={{ accentColor: "var(--spice-button, #1ed760)" }} checked={!!gradient}
               onChange={() => edit({ gradient: gradient ? null : { colors: [choice.accent, choice.background], angle: 160, intensity: 0.5 } })} />
        <span>{t("look.gradientOn")}</span>
      </label>
      {gradient && (
        <div className="sai-in">
          {gradient.colors.map((color, i) => (
            <div key={`${i}-${gradient.colors.length}-${choice.preset ?? ""}`} style={row}>
              <div style={labelStyle}>{t("look.color", { n: i + 1 })}</div>
              <ColorField value={color} onChange={(hex) => setGradient({ colors: gradient.colors.map((c, j) => (j === i ? hex : c)) })}
                          {...(gradient.colors.length > 2 ? { onRemove: () => setGradient({ colors: gradient.colors.filter((_, j) => j !== i) }) } : {})} />
            </div>
          ))}
          {gradient.colors.length < 4 && (
            <p style={{ margin: "4px 0 12px" }}><span className="sai-link" onClick={() => setGradient({ colors: [...gradient.colors, choice.background] })}><Icon name="plus" size={14} />{t("look.addColor")}</span></p>
          )}
          <div style={row}><div style={labelStyle}>{t("look.direction")}</div><Slider value={gradient.angle} min={0} max={360} onChange={(v) => setGradient({ angle: v })} /><span style={{ ...css.muted, width: 44, textAlign: "right" }}>{gradient.angle}°</span></div>
          <div style={row}><div style={labelStyle}>{t("look.strength")}</div><Slider value={Math.round(gradient.intensity * 100)} min={0} max={100} onChange={(v) => setGradient({ intensity: v / 100 })} /><span style={{ ...css.muted, width: 44, textAlign: "right" }}>{Math.round(gradient.intensity * 100)}%</span></div>
        </div>
      )}

      <div style={section}>{t("look.photo")}</div>
      <p style={{ ...css.muted, margin: "0 0 12px" }}>{t("look.photoNote")}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {photo && <div className="sai-photo-thumb" style={{ backgroundImage: `url(${photo})` }} />}
        <label style={{ ...css.secondary, display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
          {t(photo ? "look.photoChange" : "look.photoChoose")}
          <input type="file" accept="image/png, image/jpeg, image/webp, image/gif" style={{ display: "none" }}
                 onChange={(e: any) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {photo && <span className="sai-link" onClick={removePhoto}><Icon name="cross" size={12} />{t("look.photoRemove")}</span>}
      </div>
      {photoError && <p style={css.error}>{photoError}</p>}
      {photo && (
        <div className="sai-in" style={{ marginTop: 10 }}>
          <label style={{ ...row, cursor: "pointer" }}>
            <input type="checkbox" style={{ accentColor: "var(--spice-button, #1ed760)" }} checked={!!photoSet}
                   onChange={() => repaint(photoSet ? null : { strength: 0.55 })} />
            <span>{t("look.photoOn")}</span>
          </label>
          {photoSet && (
            <div style={row}><div style={labelStyle}>{t("look.strength")}</div>
              <Slider value={Math.round(photoSet.strength * 100)} min={0} max={100} onChange={(v) => repaint({ strength: v / 100 })} />
              <span style={{ ...css.muted, width: 44, textAlign: "right" }}>{Math.round(photoSet.strength * 100)}%</span></div>
          )}
        </div>
      )}

      <p style={{ margin: "28px 0 0" }}><button style={css.secondary} disabled={!saved} onClick={() => use(null)}>{t("look.reset")}</button></p>
    </div>
  );
}
