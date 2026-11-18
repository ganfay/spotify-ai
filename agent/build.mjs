// Build script.
//
//   node build.mjs            build the custom app into dist/ai-playlists
//   node build.mjs --install  build + copy into Spicetify's CustomApps folder
//   node build.mjs --release  build + refresh agent/release/ (the copy install.sh uses)
//   node build.mjs --test X   bundle test/X.ts into a script for scripts/dev/cdp-eval.mjs

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const APP = "ai-playlists";
const out = join("dist", APP);
// Address of the owner's deployed proxy, baked into the build as the default.
// Set it in agent/proxy-url.txt (one line) or the PROXY_URL environment variable.
let proxyUrl = process.env.PROXY_URL ?? "";
try {
  proxyUrl ||= (await readFile("proxy-url.txt", "utf8")).trim();
} catch {
  // no file -> no default proxy; users can still use their own key
}
const common = { bundle: true, target: "es2022", logLevel: "warning", define: { __DEFAULT_PROXY_URL__: JSON.stringify(proxyUrl) } };

const testIndex = process.argv.indexOf("--test");
if (testIndex !== -1) {
  const name = process.argv[testIndex + 1];
  await mkdir("dist", { recursive: true });
  await build({
    ...common,
    entryPoints: [join("test", `${name}.ts`)],
    outfile: join("dist", `${name}.test.js`),
    format: "iife",
    globalName: "__test",
    footer: { js: "__test.run()" }, // the script's value is the test's promise
  });
  console.log(`built dist/${name}.test.js`);
  process.exit(0);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// The page. Spicetify loads it lazily, only when the page is opened, and
// expects a global function render().
await build({
  ...common,
  entryPoints: ["src/app/index.tsx"],
  outfile: join(out, "index.js"),
  format: "iife",
  globalName: "__aiPlaylists",
  minify: true,
  jsxFactory: "Spicetify.React.createElement",
  jsxFragment: "Spicetify.React.Fragment",
  footer: { js: "function render(){return __aiPlaylists.render();}" },
});

// The startup extension: applies the saved look. Kept as small as possible (see src/core/index.ts).
await build({ ...common, entryPoints: ["src/core/index.ts"], outfile: join("dist", "spotify-ai-core.js"), format: "iife", minify: true });

// Spicetify itself puts a link to a custom app into the top bar, using this icon.
// So the app needs no startup code at all (decision 9).
const icon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M10 2.5l2.2 5.8 5.8 2.2-5.8 2.2L10 18.500l-2.2-5.800L2 10.500l5.800-2.200L10 2.500z"/><path d="M18.500 14l1.050 2.700 2.700 1.050-2.700 1.050L18.500 21.500l-1.050-2.700-2.700-1.050 2.700-1.050L18.500 14z"/></svg>';
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify({ name: "AI Playlists", icon, "active-icon": icon, subfiles: [], subfiles_extension: [] }, null, 2),
);
console.log(`built ${out}`);

// A ready-to-install copy kept in the repository, so the installer needs no Node.js.
if (process.argv.includes("--release")) {
  const target = join("release", APP);
  await rm(target, { recursive: true, force: true });
  await cp(out, target, { recursive: true });
  await cp(join("dist", "spotify-ai-core.js"), join("release", "spotify-ai-core.js"));
  await rm(join("release", "theme"), { recursive: true, force: true });
  await cp("theme", join("release", "theme"), { recursive: true });
  console.log(`copied to agent/${target} (commit it)`);
}

if (process.argv.includes("--install")) {
  const target = join(homedir(), ".config", "spicetify", "CustomApps", APP);
  await rm(target, { recursive: true, force: true });
  await cp(out, target, { recursive: true });
  console.log(`copied to ${target}`);
}
