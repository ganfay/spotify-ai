#!/usr/bin/env node
// Save a PNG screenshot of the running Spotify client (started with --remote-debugging-port).
//   node scripts/dev/cdp-shot.mjs out.png
import { writeFile } from "node:fs/promises";

const port = process.env.SPOTIFY_DEBUG_PORT ?? "9222";
let target;
for (const host of ["[::1]", "127.0.0.1"]) {
  try {
    const pages = await (await fetch(`http://${host}:${port}/json`)).json();
    target = pages.find((p) => p.type === "page" && p.url.includes("xpui.app.spotify.com"))?.webSocketDebuggerUrl;
    if (target) break;
  } catch { /* next host */ }
}
if (!target) throw new Error("Spotify page not found");
const ws = new WebSocket(target);
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
ws.onmessage = async (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id !== 1) return;
  await writeFile(process.argv[2], Buffer.from(msg.result.data, "base64"));
  ws.close();
};
