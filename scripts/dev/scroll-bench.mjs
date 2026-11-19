#!/usr/bin/env node
// DEVELOPMENT ONLY. Scrolls the playlist "legend" (or the first playlist) for 6 s inside the running
// client and reports frame pacing, plus CPU time of the renderer and GPU processes. Needs Spotify
// started with --remote-debugging-port (see cdp-eval.mjs) and Linux `ps`.
//
//   node scripts/dev/scroll-bench.mjs <label> [extra.css]
//   MODE=stock  apply no look for the run      MODE=look  apply the look saved in the app
//   REPLACE=1   switch off the installed user.css (use with a stylesheet given as extra.css)
//
// The machine's own load changes a lot between runs: compare only runs taken in turns.
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const [label = "run", cssFile] = process.argv.slice(2);
const extra = cssFile ? await readFile(cssFile, "utf8") : "";
const port = process.env.SPOTIFY_DEBUG_PORT ?? "9223";
let pages;
for (const host of ["[::1]", "127.0.0.1"]) {
  try { pages = await (await fetch(`http://${host}:${port}/json`)).json(); break; } catch { /* next */ }
}
if (!pages) throw new Error(`Spotify not found on port ${port}`);
const ws = new WebSocket(pages.find((p) => p.type === "page" && p.url.includes("xpui")).webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const call = (method, params) => new Promise((res) => {
  const me = ++id;
  const h = (e) => { const m = JSON.parse(e.data); if (m.id === me) { ws.removeEventListener("message", h); res(m.result); } };
  ws.addEventListener("message", h);
  ws.send(JSON.stringify({ id: me, method, params }));
});
const cpu = () => execSync("ps -C spotify -o cputimes=,args= | awk '{k=\"o\"; if ($0 ~ /type=renderer/) k=\"r\"; else if ($0 ~ /type=gpu/) k=\"g\"; s[k]+=$1} END {printf \"%d %d\", s[\"r\"], s[\"g\"]}'").toString().trim().split(" ").map(Number);
const mode = process.env.MODE || "keep";
const expr = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let st = document.getElementById('sai-bench'); if (!st) { st = document.createElement('style'); st.id = 'sai-bench'; document.head.appendChild(st); }
  st.textContent = ${JSON.stringify(extra)};
  for (const l of document.querySelectorAll('link.userCSS')) if (/user\\.css/.test(l.href)) l.disabled = ${JSON.stringify(!!process.env.REPLACE)};
  if (${JSON.stringify(mode)} === 'stock') window.__spotifyAiAppearance(null);
  if (${JSON.stringify(mode)} === 'look') window.__spotifyAiAppearance(JSON.parse(localStorage.getItem('spotify-ai:appearance')));
  const r = await Spicetify.Platform.RootlistAPI.getContents(); const p = r.items.find((i) => i.name === 'legend') || r.items.find((i) => i.type === 'playlist');
  const route = '/playlist/' + p.uri.split(':')[2];
  if (location.pathname !== route) { Spicetify.Platform.History.push(route); await sleep(3000); }
  const vp = document.querySelector('.Root__main-view [data-overlayscrollbars-viewport]');
  vp.scrollTop = 0; await sleep(700);
  const deltas = []; let last = performance.now(); const t0 = last; let dir = 1;
  await new Promise((done) => { const step = (now) => { deltas.push(now - last); last = now; vp.scrollTop += 38 * dir; if (vp.scrollTop > 9000) dir = -1; if (vp.scrollTop < 50) dir = 1; if (now - t0 < 6000) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
  deltas.shift(); deltas.sort((a, b) => a - b);
  const sum = deltas.reduce((a, b) => a + b, 0);
  return { fps: Math.round(10000 * deltas.length / sum) / 10, median: Math.round(deltas[deltas.length >> 1] * 10) / 10, p95: Math.round(deltas[Math.floor(deltas.length * .95)] * 10) / 10, over25: deltas.filter((d) => d > 25).length };
})()`;
const before = cpu();
const res = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
const after = cpu();
console.log(label.padEnd(28), JSON.stringify(res.result?.value), "cpu s renderer/gpu:", after[0] - before[0], after[1] - before[1]);
ws.close();
