// Settings: how the agent reaches a model.
//  - shared free access through the owner's proxy (limited), or
//  - the user's own API key from any supported provider (no limits from us).

import { createSession, PROVIDERS, providerOf } from "../llm";
import { isConfigured, loadSettings, saveSettings, type Settings } from "../settings";
import { BackLink, css, hooks, Icon, ResultBadge, Spinner } from "./ui";

declare const Spicetify: any;

const field = { ...css.input, margin: "6px 0 14px" } as const;
const label = { fontWeight: 700, fontSize: 14 } as const;

export function SettingsView({ onBack }: { onBack: () => void }) {
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
      const who = own ? `${provider.label} · ${settings.model}` : "Shared access";
      setCheck(turn.text
        ? { ok: true, title: "Connected", detail: `${who} · ${ms} ms` }
        : { ok: false, title: "No answer", detail: "The model answered with nothing." });
    } catch (e) {
      setCheck({ ok: false, title: "Connection failed", detail: (e as Error).message });
    }
    setBusy(false);
  };

  return (
    <div style={{ ...css.column, marginTop: 20, maxWidth: 600 }}>
      <BackLink label="All tools" onClick={onBack} />
      <h2 style={{ fontSize: 20, margin: "6px 0 16px" }}>Settings</h2>

      <label style={{ ...css.entry, alignItems: "flex-start" }}>
        <input type="radio" checked={!own} onChange={() => update({ mode: "proxy" })} />
        <span>
          <div style={label}>Shared free access</div>
          <div style={css.muted}>No key needed. A few requests per hour, shared with other users of this build.</div>
        </span>
      </label>
      <label style={{ ...css.entry, alignItems: "flex-start" }}>
        <input type="radio" checked={own} onChange={() => update({ mode: "own-key" })} />
        <span>
          <div style={label}>My own API key</div>
          <div style={css.muted}>No limits from us. The key stays on this computer and is sent only to the provider you choose.</div>
        </span>
      </label>

      <div style={{ marginTop: 20 }}>
        {own ? (
          <div>
            <div style={label}>Provider</div>
            <select style={field} value={settings.provider} onChange={(e: any) => pickProvider(e.target.value)}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>

            <div style={label}>API key</div>
            <div style={css.muted}>{provider.keyHint}</div>
            <input style={field} type="password" autoComplete="off" value={settings.apiKey}
                   placeholder={provider.id === "custom" ? "Leave empty if your local model needs no key" : "Paste your key"}
                   onChange={(e: any) => update({ apiKey: e.target.value })} />

            <div style={label}>Model</div>
            <div style={css.muted}>The exact model name from your provider. It must support tool calling.</div>
            <input style={field} value={settings.model} placeholder="model name" onChange={(e: any) => update({ model: e.target.value })} />

            {provider.baseUrl !== undefined && (
              <div>
                <div style={label}>Address {provider.id !== "custom" && <span style={css.muted}>(optional)</span>}</div>
                <input style={field} value={settings.baseUrl} placeholder={provider.baseUrl || "https://…/v1"}
                       onChange={(e: any) => update({ baseUrl: e.target.value })} />
              </div>
            )}
          </div>
        ) : (
          <div>
            {!settings.proxyUrl && <p style={css.error}>This build has no shared access configured. Use your own API key instead.</p>}
            <details className="sai-adv">
              <summary><Icon name="chevron" size={14} />Advanced — for developers only</summary>
              <div style={{ margin: "12px 0 0 20px" }}>
                <p style={css.muted}>
                  These two fields connect the app to its AI server. They are already set correctly.
                  Change them only if you run your own server — a wrong value makes the AI stop working.
                </p>
                {unlock === "locked" && (
                  <button style={{ ...css.secondary, display: "inline-flex", alignItems: "center", gap: 8, margin: "4px 0 14px" }} onClick={() => setUnlock("asking")}>
                    <Icon name="lock" size={15} />Unlock editing
                  </button>
                )}
                {unlock === "asking" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "4px 0 14px" }}>
                    <span>Are you sure? You normally never need this.</span>
                    <button style={css.danger} onClick={() => setUnlock("open")}>Yes, let me edit</button>
                    <button style={css.secondary} onClick={() => setUnlock("locked")}>Cancel</button>
                  </div>
                )}
                <div style={label}>Server address</div>
                <input style={{ ...field, opacity: unlock === "open" ? 1 : 0.55 }} readOnly={unlock !== "open"} value={settings.proxyUrl}
                       placeholder="https://example.workers.dev" onChange={(e: any) => update({ proxyUrl: e.target.value })} />
                <div style={label}>Invite code <span style={css.muted}>(only if the server owner gave you one)</span></div>
                <input style={{ ...field, opacity: unlock === "open" ? 1 : 0.55 }} readOnly={unlock !== "open"} value={settings.inviteCode}
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
          {busy ? "Testing" : "Test connection"}
        </button>
        <span style={css.muted}>Changes are saved automatically.</span>
      </div>
      {check && <ResultBadge ok={check.ok} title={check.title} detail={check.detail} />}
      <p style={css.muted}>
        What is sent to the AI: your request text and the playlists it needs to read (track titles, artists, albums).
        Never your Spotify login. On free AI tiers the provider may use this data to improve its models.
      </p>
    </div>
  );
}
