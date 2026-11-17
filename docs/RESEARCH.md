# Phase 0 research report

Date: 2026-11-17. Sources were read on that day. Nothing was installed or executed.

Confidence tags: **[V]** verified in source code / official docs, **[R]** stated in a README or FAQ, **[C]** community report, **[U]** unverified — must be tested live.

## Summary: what changed compared with the brief

| # | Finding | Effect |
|---|---|---|
| F1 | SpotX and SpotX-Bash maintainers both say: *do not use together with Spicetify* (works in the order SpotX → Spicetify, but unsupported). | Our core architecture is an unsupported combination. |
| F2 | SpotX ad blocking cannot be separated from a client-side "premium" product-state override. The only switch (`-p`) also turns ad blocking off. | "Ads only, no premium unlocking" is not possible with SpotX. The Spicetify fallback (adblockify) does the same override. |
| F3 | Open issue: ads still play for some users on 1.2.99 → 1.3.4.258 (SpotX-Bash #146, incl. Linux). Maintainer cannot reproduce. | SpotX may fail Phase 1 tests on the exact version used here. |
| F4 | SpotX-Bash has no update blocking on Linux. | Use `apt-mark hold spotify-client`. |
| F5 | SpotX (Windows) downloads the Spotify installer from the maintainer's own Cloudflare Worker, adds Microsoft Defender exclusions and sends version info to the maintainer's server by default. | Flags exist to turn the last two off; must be disclosed to friends. |
| F6 | The public Web API (`api.spotify.com/v1`) answers **429** to the in-client token since about Dec 2025. | The agent must use internal client APIs only (`Spicetify.Platform.*`, `spclient`, GraphQL). They are undocumented and can change. |
| F7 | Gemini API terms: the key owner must be **18+**; free tier may **not** serve users in the EEA / Switzerland / UK; free-tier prompts are used for training and may be read by humans. | Affects who creates the key, and free vs paid tier. |
| F8 | Spotify User Guidelines forbid modifying the client, blocking ads and feeding Spotify content into AI models. | Honest risk note in README. No confirmed ban wave, but the risk is not zero. |
| F9 | `gabo` lesson confirmed by maintainers: blocking all of `gabo-receiver-service` kills "Recently played" on clients ≥ 1.2.74. SpotX and SpotX-Bash now block only the `/public` path. | Stats should work with SpotX; still must be tested. |
| F10 | Spicetify v3 (release candidate) replaces extensions/custom apps with "modules". | Pin Spicetify v2; expect a migration later. |

## 1. SpotX / SpotX-Bash

- **Status:** both active. SpotX-Bash last commit 2026-11-12 (`48bd283fa`, "Support 1.3.9.2055"); SpotX last commit 2026-11-14. No GitHub releases are used — delivery is the `main` branch script. [V]
- **License:** MIT for both. Downloading and running their script at install time is allowed. [V]
- **Version support:** SpotX-Bash supports 1.3.4.258 on the official `.deb` (`/usr/share/spotify` is a built-in search path). Spotify apt *stable* is 1.3.4.258 today. Flatpak is supported by the same script; snap needs a separate script. [V]
- **Linux needs:** x86_64, `perl`, `unzip`, `zip`, and `sudo` (client files are root-owned). It runs `pkill -9 spotify`. [V]
- **macOS:** no sudo; needs `codesign` (Xcode command line tools); app is re-signed ad hoc. [V]
- **Windows:** Microsoft Store version is not supported and is removed. SpotX installs/downgrades Spotify to its recommended version (1.3.10 today) — Spicetify supports only up to 1.3.9, so the version must be pinned with `-v`. [V]
- **How ads are blocked:** regex patches of JS/CSS inside `Apps/xpui.spa` + byte patches of the Spotify binary (ad endpoints renamed, ad slots nulled, ~70 ad feature flags off). No hosts-file edits. Claims audio, banner and video ads. [V/R]
- **Stats:** analytics blocking is on by default with no flag to disable it: `gabo-receiver-service/p…` (public path), `sp://logging/v3/*`, Sentry. The non-public gabo path that carries playback events is left alone on purpose (SpotX fix `bf78e900b`, 2025-11-13, issue SpotX#793). Wrapped is not explicitly confirmed. [V + C]
- **Update blocking:** Windows `-block_update_on`; macOS `-B`; Linux none. [V]
- **Unattended flags:** Bash `--noninteractive` (+ `--installdeb --stable` to also install Spotify), `-e` (no experimental features), `-f` (force re-patch), `--uninstall`. Windows: one flag per prompt (`-confirm_*`, `-podcasts_*`, `-block_update_on`, `-defender_exclusions_off`, `-sendversion_off`, `-no_pause`, `-v`). [V]
- **Windows + Spicetify conflict:** if Spicetify is already applied, `run.ps1` shows a prompt with no bypass flag → the installer must run `spicetify restore` first. [V]
- **Uninstall:** `spotx.sh --uninstall` (restores `.bak` files); Windows `Uninstall.bat`; or reinstall Spotify. [V]
- **Remote code note:** the script is fetched from `main` → pin a commit SHA in our installer. [V]

Sources: <https://github.com/SpotX-Official/SpotX-Bash>, <https://github.com/SpotX-Official/SpotX>, SpotX-Bash FAQ (wiki), <https://github.com/SpotX-Official/SpotX/issues/793>, <https://github.com/SpotX-Official/SpotX-Bash/issues/146>, <https://github.com/SpotX-Official/SpotX/issues/908>.

## 2. Spicetify

- **Status:** v2.46.7 (2026-11-12). Supports Spotify 1.2.14 → 1.3.9 (Windows, macOS) and → 1.3.8 (Linux). 1.3.4 on Linux is inside the range. Healthy project. License LGPL-2.1 (cli), MIT (marketplace). [V]
- **Install:** one-line scripts for each OS, installs to `~/.spicetify`. On the apt `.deb` it needs `sudo chmod a+wr /usr/share/spotify` and `sudo chmod a+wr /usr/share/spotify/Apps -R`. Spicetify itself must not run as root. The official install scripts ask questions → for an unattended install we unpack the release archive ourselves. [V]
- **Commands:** `backup` (save stock files), `apply` (write patched files), `restore` (back to stock). A Spotify update removes Spicetify; repair = `spicetify backup apply` (or `restore backup apply`). [V]
- **Update blocking:** `spicetify spotify-updates block` — Windows and macOS only. [V]
- **Extension vs custom app:**
  - *Extension* = one JS file, runs at Spotify startup.
  - *Custom app* = a folder with its own page and sidebar entry; its code is loaded **only when the page is opened** (`React.lazy`). A tiny `subfiles_extension` can add a button at startup.
  - Heavy code can also be loaded on click with dynamic `import()` from a tiny `.mjs` loader (the Sort-Play extension does this). [V]
- **UI surfaces:** top-bar button, playbar button, context menu items, popup modal, right side panel, profile menu item, full page (custom app). No API for adding a section to Spotify's settings page. [V]
- **Build tooling:** `spicetify-creator` was deprecated on 2025-12-31 → use esbuild with our own config. [V]
- **Data APIs to use** (internal, undocumented; verified in other extensions' code from Sept–Nov 2026) [C]:

| Need | Call |
|---|---|
| Playlists and folders | `Platform.RootlistAPI.getContents()` |
| Playlist tracks | `Platform.PlaylistAPI.getContents(uri, {limit})` |
| Liked Songs | `Platform.LibraryAPI.getTracks({limit})` |
| Create playlist | `Platform.RootlistAPI.createPlaylist(name, {before: "start"})` |
| Add / remove / move | `Platform.PlaylistAPI.add / remove / move` (remove and move take `{uri, uid}`) |
| Delete playlist | `Platform.RootlistAPI.remove([{uri}])` |
| Search | `Spicetify.GraphQL.Request(Definitions.searchTracks, …)` |
| ISRC, popularity | `spclient…/metadata/4/track/{hexGid}` |
| Energy, valence, tempo | `spclient…/audio-attributes/v1/audio-features/{id}` |
| Lyrics (any track) | `spclient…/color-lyrics/v2/track/{id}` |
| Similar tracks | `PlaylistAPI.getRecommendedTracks(uri, offset, limit)`, `spclient…/inspiredby-mix/v2/seed_to_playlist/{uri}`, GraphQL `fetchTracksForRadioStation` |

- **Not available in-client:** artist genres (no reliable internal source). Options: LLM knowledge, or an external source such as Last.fm tags later.
- **Pitfalls:** `CosmosAsync` does not throw on HTTP errors (returns `{code, error}`); it routes non-Spotify URLs through Spicetify's CORS proxy → use plain `fetch` for our Worker/Gemini calls. Reordering by remove + re-add resets "date added" → use `move`. [V/C]
- **Lyrics on free accounts:** monthly-limit prompts were reported; endpoint behaviour is [U] → build a fallback (LRCLIB) and a cache.

Sources: <https://github.com/spicetify/cli>, <https://spicetify.app/docs/getting-started>, <https://github.com/spicetify/cli/issues/3670>, <https://github.com/spicetify/spicetify-creator>, <https://github.com/hoeci/sort-play>.

## 3. Fallback ad blockers

| Tool | Alive | License | Audio ads | Blocks stats | Idle cost | OS |
|---|---|---|---|---|---|---|
| **rxri adblockify** (Spicetify extension) | yes, last commit 2026-09-10 "support 1.3.0" | MIT | yes by design [U on 1.3.4+] | no | none (event-driven) | all |
| AdBlockee-Spicetify | new (Oct 2026) | MIT | yes by design | no | 500 ms polling | all |
| abba23/spotify-adblock | yes | GPL-3.0 | yes | **yes** (all of gabo, since 2021) | none | Linux only |
| BlockTheSpot (+ fork) | archived / fork alive | none | yes | **yes** | n/a | Windows |
| hosts / DNS lists | mostly dead | — | no | — | — | — |

- adblockify works at the ad-engine level (product-state override, ad slot settings, ad managers disabled). It uses no timers and no DOM observers, and does not touch gabo or logging. It also sets the product state to "premium" (same as SpotX, see F2). [V]
- One community note says some of its levers are inert on 1.3.0 and only the ad-server-endpoint override still works. [C]
- **Best fallback: adblockify, installed from its repo (not from Marketplace, which lagged behind).**
- For abba23 on Linux, the minimal fix is to block only `gabo-receiver-service/public/.*` instead of the whole path (mirrors the SpotX fix). [U]

Sources: <https://github.com/rxri/spicetify-extensions>, <https://github.com/abba23/spotify-adblock>, <https://github.com/SpotX-Official/SpotX-Bash/pull/112>.

## 4. Existing AI playlist tools

- **Spotify developer policy** [V]: development mode = max 5 allow-listed users and the owner needs Premium; extended quota = registered business with ≥ 250k monthly active users. Many Web API endpoints were removed for new apps (2024-11-27 and Feb 2026). → An in-client extension is the only realistic way for an individual.
- **Spotify's own AI** (AI DJ, AI Playlist, Prompted Playlist, Smart Filters, ChatGPT/Claude connectors): Premium-only and/or limited markets; they *create* playlists, none cleans, dedupes or splits an existing one, none has undo.
- **Strongest in-client rival: [hoeci/sort-play](https://github.com/hoeci/sort-play)** (MIT, active): sorting, heuristic duplicate manager, fixed vibe/genre filters, a one-shot Gemini "AI Pick". No conversational agent, no language filter, no undo.
- **SmartSort** (reference in the brief): one prompt → 0–100 scores → new playlist. No preview, no reasons, no undo, no license, inactive. It calls Web API endpoints that now return 429 or were renamed.
- **MCP servers for Spotify** exist (good prior art for tool design) but need the user's own developer app + Premium.

**Gaps we can own**

1. A conversational agent with tools inside the desktop client.
2. Preview → confirm → real undo for every change (nobody has undo).
3. Ukrainian vs Russian separation with an "unsure" bucket (nobody addresses it).
4. "Why doesn't this track fit" cleanup with checkboxes (nobody found).
5. Version-aware dedupe with a keep-policy in plain words ("keep the album studio version").
6. Works on free accounts, in any country, without a developer app.

**Ideas beyond the five core features:** replace unavailable (greyed-out) tracks; automatic backup before each write; saved rules for a playlist; "which playlist does this track belong in?".

## 5. Gemini API and Cloudflare Workers

**Gemini** (official docs, terms effective 2026-03-23) [V unless noted]:

- **Model:** `gemini-3.5-flash-lite` — $0.30 / $2.50 per 1M input/output tokens, 1M-token context, 65k output, function calling + structured output, free tier available. Rough cost: about $0.10 to classify a 3,000-track playlist (estimate).
- **Free-tier limits** are shown only in the logged-in console; third-party numbers: about 10 requests/min and 500 requests/day for Flash-Lite. Limits are per project, not per key. [U]
- **Function-calling quirks:** thought signatures must be passed back unchanged; parallel calls must not be interleaved with responses; structured output supports only a subset of JSON Schema; output cap → classify in chunks of a few hundred tracks.
- **Terms:**
  - "You must be 18 years of age or older to use the APIs."
  - "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." Paid = a project with an active billing account (min. $5 prepay; monthly spend cap available).
  - Free tier: content is used to improve Google products and "human reviewers may read, annotate, and process your API input and output". Paid tier: not used for training.
  - A backend proxy is allowed and recommended; the key must stay confidential; the proxy should be app-specific, not a generic Gemini pass-through.
- **Direct calls from the Spotify client** (own-key mode): CORS preflight from origin `https://xpui.app.spotify.com` succeeds. Whether Spotify's content security policy blocks it is [U].

**Cloudflare Workers free plan** [V]: 100,000 requests/day; 10 ms CPU per request (waiting for Gemini does not use CPU [U]); KV has only 1,000 writes/day → wrong tool for counters; **SQLite-backed Durable Objects** are on the free plan and give exact counters. Secrets: `npx wrangler secret put NAME`. Streaming responses through a Worker has no time limit while the client is connected.

**README privacy note must say:** what is sent (track titles, artists, playlist names, chat text, sometimes lyrics), that it goes to our Worker and then to Google, free vs paid tier and what that means, what the Worker stores (counters only, no prompts), that own-key mode goes directly to Google, 18+.

## 6. Identifying users at the proxy

| Option | How easy to fake | Verdict |
|---|---|---|
| Spotify user ID sent by the client | trivial (IDs are public) | label only |
| Forwarding the Spotify session token to the Worker | hard | **rejected** — breaks "the user never gives credentials to anyone" |
| Random install ID | trivial | no |
| Per-IP limit | medium | coarse backstop |
| **Per-friend invite code** | hard unless leaked; revocable | **primary** |
| Cloudflare Turnstile | — | skip |

Plus global safety caps: daily global budget below the Gemini quota, kill switch, fixed model, server-side limits on request size and output tokens.

The invite code can be part of the personal install command a friend receives, so the friend still types nothing.

## 7. Performance measurement (Linux)

Checked on the dev machine: cgroup v2 is in use and GNOME starts Spotify in its own scope, so the kernel already accounts for all Spotify processes together. No extra tools are needed.

- **RAM:** sum of `Pss` from `/proc/<pid>/smaps_rollup` over all Spotify processes (PSS counts shared memory once). Sampled every 5 s over a window; report the median.
- **Idle CPU:** difference of `usage_usec` in the scope's `cpu.stat` over 120 s, as % of one core. Two states: paused, and playing a fixed track.
- **Startup:** time from launch until (a) the window exists and (b) CPU usage has stayed below 10 % of one core for 3 s ("settled"). Warm starts only; first run discarded.
- **Protocol:** same account, same playlist and track, same window size, no other heavy apps, on AC power; 5 runs each; report median and min–max. Raw numbers and the script go to `docs/perf/`.
- **Later:** the same idea with Windows performance counters and macOS `footprint` / `ps`.

## Things that can only be verified live

1. Do SpotX-Bash patches block audio ads on 1.3.4.258 `.deb` for 1 hour of listening?
2. Do "Recently played" and "Listening stats" keep counting with SpotX-Bash? Wrapped?
3. Does `spicetify backup apply` work on top of SpotX-Bash on this exact build?
4. Do the internal API calls in section 2 exist with these signatures on 1.3.4? Throttling under bulk use (2,000 tracks)?
5. Does the lyrics endpoint work on a free account, and is there a cap?
6. Does adblockify block audio ads on 1.3.4?
7. Exact Gemini free-tier limits (visible in the console of the key owner).
8. Idle cost of Spicetify itself.
