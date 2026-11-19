// A one-time hint on the first start after install: a bubble with an arrow under the
// AI Playlists button in Spotify's top bar, so a new user knows where to begin. Pressing
// the button opens our page, where the guided tour takes over (src/app/tour.tsx).
// Once dismissed or used it never shows again; after that it costs two storage reads.

const HINT_KEY = "spotify-ai:hint:v1";
const TOUR_KEY = "spotify-ai:tour:v1";

const TEXT: Record<string, [string, string]> = {
  en: ["New: AI Playlists", "Your AI playlist tools and themes for Spotify are here. Press the button to start."],
  uk: ["Нове: AI Playlists", "Тут AI-інструменти для плейлистів і теми для Spotify. Натисни кнопку, щоб почати."],
  ru: ["Новое: AI Playlists", "Здесь AI-инструменты для плейлистов и темы для Spotify. Нажми кнопку, чтобы начать."],
  de: ["Neu: AI Playlists", "Hier sind die KI-Werkzeuge für Playlists und Designs für Spotify. Drück den Knopf zum Starten."],
};

function language(): string {
  let chosen = "auto";
  try { chosen = JSON.parse(localStorage.getItem("spotify-ai:settings") || "{}").language || "auto"; } catch { /* default */ }
  const s = (window as unknown as { Spicetify?: any }).Spicetify;
  const raw = chosen !== "auto" ? chosen : String(s?.Locale?.getLocale?.() ?? s?.Platform?.Session?.locale ?? navigator.language ?? "en");
  const code = raw.slice(0, 2).toLowerCase();
  return code in TEXT ? code : "en";
}

export function firstStartHint(): void {
  try {
    if (localStorage.getItem(HINT_KEY) || localStorage.getItem(TOUR_KEY) === "done") return;
  } catch {
    return;
  }
  let tries = 0;
  const timer = setInterval(() => {
    const button = document.querySelector<HTMLElement>('.main-globalNav-navLink[aria-label="AI Playlists"]');
    if (button) {
      clearInterval(timer);
      show(button);
    } else if (++tries > 120) clearInterval(timer);
  }, 500);
}

function show(button: HTMLElement): void {
  const [title, text] = TEXT[language()]!;
  const accent = "var(--spice-button, #1ed760)";
  const root = document.createElement("div");
  // Spotify hides every div put straight into <body> that has neither an id nor a class.
  root.id = "sai-first-start-hint";
  root.innerHTML =
    `<style>@keyframes sai-hint-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,${accent} 70%,transparent)}100%{box-shadow:0 0 0 14px transparent}}` +
    `@keyframes sai-hint-in{from{opacity:0;transform:translateY(6px)}}</style>` +
    `<div data-ring style="position:fixed;border-radius:50%;pointer-events:none;z-index:9999;border:2px solid ${accent};animation:sai-hint-pulse 1.4s ease-out infinite"></div>` +
    `<div data-card role="dialog" style="position:fixed;z-index:9999;width:280px;padding:14px 16px;border-radius:12px;background:#282828;color:#fff;` +
    `font:14px/1.45 var(--encore-body-font-stack, system-ui, sans-serif);box-shadow:0 12px 32px rgba(0,0,0,.5);border-top:3px solid ${accent};animation:sai-hint-in .3s ease-out">` +
    `<div data-arrow style="position:absolute;top:-9px;width:14px;height:14px;background:${accent};transform:rotate(45deg)"></div>` +
    `<button data-close aria-label="×" style="position:absolute;top:6px;right:8px;background:none;border:0;color:#b3b3b3;font-size:18px;cursor:pointer;line-height:1">×</button>` +
    `<div style="font-weight:700;font-size:15px;margin:0 18px 4px 0"></div><div style="color:#cfcfcf"></div></div>`;
  const ring = root.querySelector<HTMLElement>("[data-ring]")!;
  const card = root.querySelector<HTMLElement>("[data-card]")!;
  const arrow = root.querySelector<HTMLElement>("[data-arrow]")!;
  card.children[2]!.textContent = title;
  card.children[3]!.textContent = text;

  const place = () => {
    const r = button.getBoundingClientRect();
    const size = Math.max(r.width, r.height) + 8;
    Object.assign(ring.style, { left: `${r.left + r.width / 2 - size / 2}px`, top: `${r.top + r.height / 2 - size / 2}px`, width: `${size}px`, height: `${size}px` });
    const left = Math.max(8, Math.min(innerWidth - 288, r.left + r.width / 2 - 140));
    Object.assign(card.style, { left: `${left}px`, top: `${r.bottom + 14}px` });
    arrow.style.left = `${r.left + r.width / 2 - left - 7}px`;
  };
  const close = () => {
    try { localStorage.setItem(HINT_KEY, "done"); } catch { /* ignore */ }
    root.remove();
    removeEventListener("resize", place);
    button.removeEventListener("click", close);
    removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  root.querySelector("[data-close]")!.addEventListener("click", close);
  button.addEventListener("click", close);
  addEventListener("resize", place);
  addEventListener("keydown", onKey);
  document.body.appendChild(root);
  place();
}
