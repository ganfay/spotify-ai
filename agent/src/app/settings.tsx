// Settings: interface language and how the agent reaches a model:
//  - shared free access through the owner's proxy (limited), or
//  - the user's own API key from any supported provider (no limits from us).

import { createSession, LlmError, PROVIDERS, providerOf } from "../llm";
import { isConfigured, loadSettings, saveSettings, type Settings } from "../settings";
import { type Key, LANGUAGES, t } from "./i18n";
import { BackLink, css, hooks, Icon, ResultBadge, Spinner } from "./ui";

declare const Spicetify: any;

const field = { ...css.input, margin: "6px 0 14px" } as const;
const label = { fontWeight: 700, fontSize: 14 } as const;
const section = { ...css.muted, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, fontSize: 11, margin: "22px 0 8px" } as const;

/** A model-layer error in the user's language. */
export function errorText(e: unknown): string {
  if (e instanceof LlmError) {
    const key = `err.${e.code}` as Key;
    const text = t(key, e.details);
    if (text !== key) return text;
  }
  return (e as Error)?.message ?? String(e);
}

export function SettingsView({ onBack, onLanguage }: { onBack: () => void; onLanguage: (choice: Settings["language"]) => void }) {
  const { useState } = hooks();
  const [settings, setSettings] = useState(loadSettings());
  const [check, setCheck] = useState(null as null | { ok: boolean; title: string; detail: string });
  const [busy, setBusy] = useState(false);
  const [unlock, setUnlock] = useState("locked" as "locked" | "asking" | "open");

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    setCheck(null);
    if (patch.language) onLanguage(patch.language);
  };
  const provider = providerOf(settings);
  const own = settings.mode === "own-key";
  const pickProvider = (id: string) => {
    const next = PROVIDERS.find((p) => p.id === id) ?? provider;
    update({ provider: next.id, model: next.defaultModel, baseUrl: "" });
  };

  const test = async () => {
    setBusy(true);
    setCheck(null);
    const started = performance.now();
    try {
      const session = createSession(settings, { system: "Reply with the single word OK.", tools: [] }, () => crypto.randomUUID());
      const turn = await session.send({ text: "Say OK" });
      const ms = Math.round(performance.now() - started);
      const who = own ? `${provider.label} · ${settings.model}` : t("set.sharedAccess");
      setCheck(turn.text
        ? { ok: true, title: t("set.connected"), detail: `${who} · ${ms} ms` }
        : { ok: false, title: t("set.noAnswer"), detail: t("set.noAnswerText") });
    } catch (e) {
      setCheck({ ok: false, title: t("set.failed"), detail: errorText(e) });
    }
    setBusy(false);
  };

  const locked = unlock !== "open";
  return (
    <div style={{ ...css.column, marginTop: 20, maxWidth: 600 }}>
      <BackLink label={t("back.tools")} onClick={onBack} />
      <h2 style={{ fontSize: 20, margin: "6px 0 4px" }}>{t("set.title")}</h2>

      <div style={section}>{t("set.language")}</div>
      <select style={{ ...field, marginTop: 0 }} value={settings.language} onChange={(e: any) => update({ language: e.target.value })}>
        <option value="auto">{t("set.langAuto")}</option>
        {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>

      <div style={section}>{t("set.access")}</div>
      <label style={{ ...css.entry, alignItems: "flex-start" }}>
        <input type="radio" checked={!own} onChange={() => update({ mode: "proxy" })} />
        <span>
          <div style={label}>{t("set.shared")}</div>
          <div style={css.muted}>{t("set.sharedText")}</div>
        </span>
      </label>
      <label style={{ ...css.entry, alignItems: "flex-start" }}>
        <input type="radio" checked={own} onChange={() => update({ mode: "own-key" })} />
        <span>
          <div style={label}>{t("set.own")}</div>
          <div style={css.muted}>{t("set.ownText")}</div>
        </span>
      </label>

      <div style={{ marginTop: 20 }}>
        {own ? (
          <div>
            <div style={label}>{t("set.provider")}</div>
            <select style={field} value={settings.provider} onChange={(e: any) => pickProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>

            <div style={label}>{t("set.key")}</div>
            <div style={css.muted}>{provider.keyHint}</div>
            <input style={field} type="password" autoComplete="off" value={settings.apiKey}
                   placeholder={t(provider.id === "custom" ? "set.keyLocal" : "set.keyPlaceholder")}
                   onChange={(e: any) => update({ apiKey: e.target.value })} />

            <div style={label}>{t("set.model")}</div>
            <div style={css.muted}>{t("set.modelHint")}</div>
            <input style={field} value={settings.model} placeholder={t("set.modelPlaceholder")} onChange={(e: any) => update({ model: e.target.value })} />

            {provider.baseUrl !== undefined && (
              <div>
                <div style={label}>{t("set.address")} {provider.id !== "custom" && <span style={css.muted}>{t("set.optional")}</span>}</div>
                <input style={field} value={settings.baseUrl} placeholder={provider.baseUrl || "https://example.com/v1"}
                       onChange={(e: any) => update({ baseUrl: e.target.value })} />
              </div>
            )}
          </div>
        ) : (
          <div>
            {!settings.proxyUrl && <p style={css.error}>{t("set.noProxy")}</p>}
            <details className="sai-adv">
              <summary><Icon name="chevron" size={14} />{t("set.adv")}</summary>
              <div style={{ margin: "12px 0 0 20px" }}>
                <p style={css.muted}>{t("set.advText")}</p>
                {unlock === "locked" && (
                  <button style={{ ...css.secondary, display: "inline-flex", alignItems: "center", gap: 8, margin: "4px 0 14px" }} onClick={() => setUnlock("asking")}>
                    <Icon name="lock" size={15} />{t("set.unlock")}
                  </button>
                )}
                {unlock === "asking" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "4px 0 14px" }}>
                    <span>{t("set.sure")}</span>
                    <button style={css.danger} onClick={() => setUnlock("open")}>{t("set.yesEdit")}</button>
                    <button style={css.secondary} onClick={() => setUnlock("locked")}>{t("act.cancel")}</button>
                  </div>
                )}
                <div style={label}>{t("set.server")}</div>
                <input style={{ ...field, opacity: locked ? 0.55 : 1 }} readOnly={locked} value={settings.proxyUrl}
                       placeholder="https://example.workers.dev" onChange={(e: any) => update({ proxyUrl: e.target.value })} />
                <div style={label}>{t("set.invite")} <span style={css.muted}>{t("set.inviteHint")}</span></div>
                <input style={{ ...field, opacity: locked ? 0.55 : 1 }} readOnly={locked} value={settings.inviteCode}
                       onChange={(e: any) => update({ inviteCode: e.target.value })} />
              </div>
            </details>
          </div>
        )}
      </div>

      <div style={{ ...css.bar, margin: "8px 0 16px" }}>
        <button style={{ ...css.primary, display: "inline-flex", alignItems: "center", gap: 10, opacity: busy || !isConfigured(settings) ? 0.6 : 1 }}
                disabled={busy || !isConfigured(settings)} onClick={test}>
          {busy && <Spinner size={16} />}
          {t(busy ? "set.testing" : "set.test")}
        </button>
        <span style={css.muted}>{t("set.saved")}</span>
      </div>
      {check && <ResultBadge ok={check.ok} title={check.title} detail={check.detail} />}
      <p style={css.muted}>{t("set.privacy")}</p>
    </div>
  );
}
