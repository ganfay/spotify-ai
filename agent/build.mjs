// Build script.
//
//   node build.mjs            build the custom app into dist/ai-playlists
//   node build.mjs --install  build + copy into Spicetify's CustomApps folder
//   node build.mjs --test X   bundle test/X.ts into a script for scripts/dev/cdp-eval.mjs

import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const APP = "ai-playlists";
const out = join("dist", APP);
const common = { bundle: true, target: "es2022", logLevel: "warning" };

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

// The only code that runs at Spotify startup: it adds one button.
await build({
  ...common,
  entryPoints: ["src/extension/button.ts"],
  outfile: join(out, "button.js"),
  format: "iife",
  minify: true,
});

const icon = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6L8 1z"/></svg>';
await writeFile(
  join(out, "manifest.json"),
  JSON.stringify({ name: "AI Playlists", icon, "active-icon": icon, subfiles: [], subfiles_extension: ["button.js"] }, null, 2),
);
console.log(`built ${out}`);

if (process.argv.includes("--install")) {
  const target = join(homedir(), ".config", "spicetify", "CustomApps", APP);
  await rm(target, { recursive: true, force: true });
  await cp(out, target, { recursive: true });
  console.log(`copied to ${target}`);
}
