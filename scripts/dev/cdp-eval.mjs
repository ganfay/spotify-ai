#!/usr/bin/env node
// DEVELOPMENT ONLY. Run a JavaScript file inside the running Spotify client and print the result.
// The debugging port lets any local program control Spotify: never leave Spotify running
// with it, and never start it this way for normal use.
//
//   spotify --remote-debugging-port=9222 --remote-allow-origins='*'
//   node scripts/dev/cdp-eval.mjs scripts/dev/api-probe.js
//
// The file must be an expression that evaluates to a value or a Promise
// (for example an async IIFE). Needs Node 22+ (built-in WebSocket).

import { readFile } from "node:fs/promises";

const port = process.env.SPOTIFY_DEBUG_PORT ?? "9222";
const hosts = ["[::1]", "127.0.0.1"];
const file = process.argv[2];
if (!file) {
  console.error("usage: cdp-eval.mjs <file.js>");
  process.exit(2);
}

async function findPage() {
  for (const host of hosts) {
    try {
      const res = await fetch(`http://${host}:${port}/json`);
      const pages = await res.json();
      const page = pages.find((p) => p.type === "page" && p.url.includes("xpui.app.spotify.com"));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // try the next host
    }
  }
  throw new Error(`Spotify page not found on port ${port}. Is Spotify running with --remote-debugging-port?`);
}

const expression = await readFile(file, "utf8");
const ws = new WebSocket(await findPage());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("cannot connect to Spotify's debugger"));
});

ws.send(JSON.stringify({
  id: 1,
  method: "Runtime.evaluate",
  params: { expression, awaitPromise: true, returnByValue: true, timeout: 120000 },
}));

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== 1) return;
  const { result, exceptionDetails } = msg.result ?? {};
  if (exceptionDetails) {
    console.error("error in page:", exceptionDetails.exception?.description ?? exceptionDetails.text);
    process.exitCode = 1;
  } else {
    console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2));
  }
  ws.close();
};
