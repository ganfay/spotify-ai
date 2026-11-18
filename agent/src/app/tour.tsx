// A short guided tour of the app: four steps, each one lights up a part of the
// home page and explains it. Shown once, on the first visit; Settings can replay it.

import { type Key, t } from "./i18n";
import { hooks } from "./ui";

declare const Spicetify: any;

const SEEN_KEY = "spotify-ai:tour:v1";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "done";
  } catch {
    return true; // no storage: do not show the tour on every visit
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "done");
  } catch {
    // ignore
  }
}

interface Step {
  /** Value of the data-tour attribute of the element to light up. */
  target: string;
  title: Key;
  text: Key;
}
const STEPS: Step[] = [
  { target: "cards", title: "tour.1.title", text: "tour.1.text" },
  { target: "agent", title: "tour.2.title", text: "tour.2.text" },
  { target: "recent", title: "tour.3.title", text: "tour.3.text" },
  { target: "settings", title: "tour.4.title", text: "tour.4.text" },
];

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
const PAD = 8;
const CARD_WIDTH = 320;
const ACCENT = "var(--spice-button, #1ed760)";

function find(target: string): HTMLElement | null {
  return document.querySelector(`[data-tour="${target}"]`);
}

export function Tour({ onClose }: { onClose: () => void }) {
  const { useEffect, useState } = hooks();
  // Steps whose element is not on the page are left out. The page is looked at after
  // it has been drawn (during the first render its elements do not exist yet).
  const [steps, setSteps] = useState(null as Step[] | null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState(null as Box | null);
  const step = steps?.[index];
  useEffect(() => {
    const found = STEPS.filter((s) => find(s.target));
    if (found.length === 0) onClose(); // nothing to show; not counted as seen
    else setSteps(found);
  }, []);

  const finish = () => {
    markSeen();
    onClose();
  };
  const next = () => (steps && index + 1 < steps.length ? setIndex(index + 1) : finish());
  const back = () => index > 0 && setIndex(index - 1);

  useEffect(() => {
    if (!step) return;
    const element = find(step.target);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => {
      const r = element.getBoundingClientRect();
      setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    measure();
    // The page scrolls smoothly and Spotify's panels can resize: keep following the element.
    const timer = setInterval(measure, 120);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      else if (event.key === "Enter" || event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [index, steps]);

  if (!steps || !step || !box) return null;

  // The card goes under the lit element, or above it when there is no room below.
  // It never leaves the window: next to an element taller than the window it overlaps its top.
  const CARD_HEIGHT = 190;
  const below = box.top + box.height + CARD_HEIGHT < window.innerHeight;
  const cardLeft = Math.max(12, Math.min(box.left, window.innerWidth - CARD_WIDTH - 12));
  const cardStyle = { top: below ? box.top + box.height + 14 : Math.max(12, box.top - CARD_HEIGHT - 14) };

  const overlay = (
    <div style={{ display: "block", position: "fixed", inset: 0, zIndex: 9999, WebkitAppRegion: "no-drag" }} onClick={(e: any) => e.stopPropagation()}>
      {/* The huge shadow darkens everything except the lit element. */}
      <div style={{
        position: "fixed", top: box.top, left: box.left, width: box.width, height: box.height, borderRadius: 14,
        border: `2px solid ${ACCENT}`, boxShadow: "0 0 0 9999px rgba(0,0,0,.72), 0 0 24px rgba(30,215,96,.35)",
        transition: "top .28s ease, left .28s ease, width .28s ease, height .28s ease", pointerEvents: "none",
      }} />
      <div key={index} className="sai-in" role="dialog" aria-label={t(step.title)} style={{
        position: "fixed", left: cardLeft, width: CARD_WIDTH, ...cardStyle, boxSizing: "border-box", padding: "16px 18px",
        borderRadius: 14, background: "var(--spice-card, #282828)", color: "var(--spice-text, #fff)",
        border: `1px solid ${ACCENT}`, boxShadow: "0 12px 40px rgba(0,0,0,.55)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--spice-subtext, #b3b3b3)", marginBottom: 6 }}>{index + 1} / {steps.length}</div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t(step.title)}</div>
        <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--spice-subtext, #b3b3b3)" }}>{t(step.text)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
          <span className="sai-link" onClick={finish}>{t("tour.skip")}</span>
          <span style={{ display: "flex", gap: 8 }}>
            {index > 0 && <button className="sai-tour-btn" onClick={back}>{t("tour.back")}</button>}
            <button className="sai-tour-btn primary" onClick={next}>{t(index + 1 < steps.length ? "tour.next" : "tour.done")}</button>
          </span>
        </div>
      </div>
    </div>
  );
  // Rendered into Spotify's root element, outside every scrolling container that could
  // clip it. (Not into <body>: Spotify's own styles hide unknown elements placed there.)
  return Spicetify.ReactDOM.createPortal(overlay, document.getElementById("main") ?? document.body);
}
