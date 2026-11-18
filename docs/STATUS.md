# Status

Last update: 2026-11-18

A new chat should read this file first, then [DECISIONS.md](DECISIONS.md) and [PLAN.md](PLAN.md).

## Where we are

**All phases are done.** Linux and Windows are tested by the owner, macOS by a friend of his (Apple Silicon). The repository is public. What is left is polish and the wishes listed below.

The repository `ganfay/spotify-ai` is **public** since 2026-11-18 (made public by the owner). Release `v0.1.0` holds `install.cmd` and `uninstall.cmd`, the files the README links to.

## What exists and works (Linux, Spotify 1.3.4.258 from apt)

| Part | Where | State |
|---|---|---|
| Installer, Windows and macOS | `install.ps1`, `install.cmd`, `uninstall.cmd`, `install.sh` | No clone needed: the scripts download `versions` and the app from this repository when they are not next to them. Install Spotify from Spotify's server when missing (signature checked), stop when Spotify is newer than `SPOTIFY_MAX`, block updates, same Spicetify steps as Linux. Passed a full cycle on GitHub's Windows and macOS machines (see below). **Not yet run by a person.** |
| Installer, Linux | `install.sh`, `versions` | One command. Holds the apt package, installs Spicetify 2.46.7, the ad blocker (adblockify at a pinned commit, checksum-verified, wrapped in a flag check) and the AI Playlists app. Re-running repairs. `--uninstall`, `--adblock on\|off`, `--block-reports on\|off`. Full cycle tested by the owner. |
| AI Playlists app | `agent/` (TypeScript, esbuild), prebuilt copy in `agent/release/` | Home with six cards, duplicate finder (no AI), AI agent with five features (duplicates, language filter, split by mood, clean-up, recommendations), Settings, "Recent changes" with Undo. Interface in English, Ukrainian, Russian, German. 24 unit tests. No code runs at Spotify startup. |
| Proxy | `worker/` (Cloudflare Worker, 44 tests) | Deployed by the owner; address in `agent/proxy-url.txt`. Holds the Gemini key as a secret. Limits: 5 prompts/hour per install id, cap on new installs per IP, global daily cap, kill switch. Invite mode exists, off. `ADMIN_TOKEN` not set → admin routes off. |
| Measuring tools | `scripts/bench/bench.py`, `scripts/dev/` | Performance and ad counter; helpers that run checks inside the live client through a debugging port. |

Design rules that must not be broken (see DECISIONS.md): the model has no tool that changes data; every change needs a click and saves an undo point; only internal client APIs, all in `agent/src/spotify/`; listening statistics are never blocked; every new text is translated into all four languages in the same change (a test enforces it).

## Evidence so far

- **Performance:** startup, paused CPU and RAM are within the agreed margins for the chosen setup ([perf/BASELINE.md](perf/BASELINE.md)). CPU while playing is not a usable metric yet — it depends on which track plays.
- **Ads:** unmodified client showed an ad at minute 8.2. With the blocker: 0 ads in 35 minutes of counted playback (`perf/results.jsonl`, label `spicetify-adblockify`).
- **Stats:** the owner sees listening minutes growing; a full check is still his to do.
- **Agent with a real model:** Gemini with the owner's key and through the proxy. The owner filtered a 1,200-track playlist by language (about 580 kept, about 8 doubtful) and split a 400-track one by mood. Recommendations returned picks with reasons in 7 s.

## Not verified yet

- Whether ads audibly return after the blocker is switched off in Settings (the ad manager is enabled again — verified; a 4-minute count showed nothing, too short).
- The language filter on a playlist of more than 1,000 tracks **after** the "must read every track" guard was added.
- Anthropic and OpenAI-compatible adapters with real keys (tested against scripted responses only).
- "Add to playlist" and its Undo for recommendations on a real playlist; Undo from the "Recent changes" list on a real change.
- Automatic interface language on a non-English Spotify.
- Russian and German texts were not proofread by native speakers.

## Known rough edges

- The agent sometimes returns 5 recommendations where 10–20 are asked for; its taste for mood splits needs tuning.
- The track count on a playlist tile can differ from the real count by 1–2 (Spotify's cached number).
- Spotify adapter error texts and provider key hints are English only.
- `Platform.LifecycleAPI.restart()` closes Spotify on Linux without reopening it — not used; "Apply now" reloads the window instead.

## Security review (2026-11-18)

An independent reviewer read the whole repository and its git history. No critical or high findings; no secrets in the tree or the history; the committed bundle is byte-identical to a rebuild from source.

Fixed after the review:

- **Proxy:** daily caps per install (100) and per address (200) so one caller cannot use up the shared quota; requests per prompt 40 → 24; only this app's ten function names, and only text / function-call parts, are accepted (no Google Search, code execution, files or media); IP addresses are stored as a keyed hash. 44 tests. Deployed by the owner on 2026-11-18 and checked with real requests: a Google Search tool, a foreign function name, inline media and a `model` field are refused with 400 without using quota; a foreign origin gets 403; a normal request with an app tool returns a function call and uses one prompt; admin routes answer 404.
- **Undo:** an old undo point first shows what it would remove and bring back and asks; the current state is saved as a new undo point before anything is restored.
- **Agent:** started from a card, it can see and change only the picked playlist; owner names are no longer sent; the card headline is written by the app, the model's summary is plain text under it; no rows are hidden; an API key is cleared when the provider is changed.
- **Installer:** the wrapper keeps the extension's strict mode; uninstall refuses to delete anything when restoring failed, and leaves a Spicetify setup that was there before us.
- **Docs:** PRIVACY.md corrected (playlist names are sent, Cloudflare sees shared-mode requests, real retention times, where the own key lives); README says plainly what installing changes on the computer.
- **CI:** `.github/workflows/check.yml` runs type checks and tests for agent and worker, and fails if `agent/release/` differs from a fresh build.
- The proxy's tests had silently stopped running (wrong package versions in `package.json`) — fixed.

Left open on purpose:

- A determined attacker with many addresses can still use up the shared free quota for a day (result: the shared mode pauses until tomorrow; own-key mode is unaffected).
- The system prompt still comes from the client, so within the caps the proxy can be used for other text tasks with this app's function names.
- `/v1/status` is not throttled (a Cloudflare rate-limit rule can be added in the dashboard).
- Owning only `/usr/share/spotify/Apps` instead of the whole folder was not tested (needs sudo on the owner's machine).
- Commits carry the owner's real name (e-mail is the no-reply address) — his decision before going public.

## Overloaded model (2026-11-18)

Google sometimes answers 503 "high demand"; a long run (1,200 tracks read) was lost at its last step. Now:

- **Proxy:** an overloaded model (500/503) is tried once more, then `FALLBACK_MODELS` (default `gemini-3.6-flash`) take over; a model out of quota (429) is skipped at once. These tries do not count against the user. 50 tests. Deployed by the owner on 2026-11-18; a normal request works. The fallback path has not been seen working against the real Google (it needs a real overload).
- **Agent:** a failed request leaves the conversation untouched; one automatic repeat after 3 s; then the chat shows the error with a **Try again** button that sends the same request again — tracks already read, tool results and proposals are kept, and the proxy sees the same prompt id (no new prompt is counted). Kept in memory only: leaving the chat or sending a new message drops it. Checked live on Linux with a simulated 503 (own-key mode). 26 tests.
- Still open: paid key or other providers in the shared mode, if overloads stay frequent.

## Model choice and saved chats (2026-11-18)

- **Proxy:** two free fallback models (`gemini-3.6-flash`, `gemini-3.8-flash`). A user may pick any model of the proxy's own list (header `x-model`, list published by `/v1/status`); the others follow as fallbacks; anything outside the list is refused. 52 tests. **Not deployed yet — the owner must run `npx wrangler deploy` in `worker/`.** Until then the app shows no model choice in shared mode (it only appears when the proxy publishes its list).
- **Settings:** shared mode has a "Model" select: Automatic (recommended) or one of the proxy's models. Seen live only with a simulated proxy answer.
- **Chats:** the last 5 chats are kept on this computer (messages and proposals; capped at about 1.5 MB, the oldest goes first). "Recent chats" on the agent's start screen reopens or deletes them; chats started from a playlist card are listed only there. A reopened chat is continued with a short text recap — the model does not remember the details; proposals stay usable, and ones already applied are marked. Checked live on Linux. 28 tests.
- **Full check the same day:** unit tests green; `installer-smoke` green on Windows and macOS without the force option; the agent run inside Spotify on Linux with real models, through the proxy and with the owner's key (duplicates, language filter on 131 tracks) — all four runs fine.
- Seen in that check, not fixed: the model sometimes answers in another language than the request and may mention an internal id like `t32` in its text; Settings shows the Linux command for "block reports" on every system.
- **Fallback models measured with the owner's free key (2026-11-18 evening), same tool-call request:** `gemini-3.5-flash-lite` 200 in 8 s; `gemini-3.1-flash-lite` 200 in 25 s; `gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-4-hydrogen` all 503 "high demand". So on the free tier only the lite models answer; the list is now `gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.8-flash`. The proxy no longer gives up when a model times out (45 s) or is unavailable, and reports `x-tried` (model=status). 54 tests. **The last change of the list is not deployed yet.**
- Lesson: my own test requests used up the daily "new installs per address" cap (5) and the owner's 5 prompts/hour — the limits work, and tests should reuse one install id.
- **Other providers as fallbacks (decision 29):** OpenRouter free models and Cloudflare Workers AI are in the proxy's chain, with a request/answer translator. 60 tests. Deployed by the owner with his OpenRouter key (2026-11-18) and tested from inside Spotify by picking each entry: all three OpenRouter models and the Workers AI model completed a three-step tool loop (2–11 s). The real agent's language filter on a 131-track playlist gave the correct proposal (130 tracks, the one Russian track left out) through `or:nvidia/nemotron-3.5-lightning:free` (47 s) and through `cf:@cf/zai-org/glm-4.7-flash` (30 s) — `agent/test/live-fallback.ts`. Not tested: a 1,200-track playlist through a fallback; an automatic switch during a real Google overload.

## Liked Songs (2026-11-18)

- Liked Songs are offered to every tool as a playlist that cannot be edited (`LIKED_URI` in the adapter): the playlist picker shows them first, the duplicate finder and the agent can read them and build new playlists from them. Spotify reports their count as 0, so the entries are counted.
- New card "Liked Songs to a playlist" (no AI): name, order (newest or oldest first), one click; local files and unplayable songs are skipped and counted; the result can be opened or deleted. Texts in four languages (the Ukrainian, Russian and German names of "Liked Songs" may differ from Spotify's own wording — not checked).
- Checked live on Linux: 965 of 966 liked songs copied in the right order in half a second, then deleted through the app; the picker and the duplicate finder work on Liked Songs (36 groups found).
- **Not verified: the agent on Liked Songs with a real model.** The test stopped on the two things below.

## Found the same evening

- **The owner's own Gemini key lost its free tier during testing:** Google answered 403 "The Gemini API free tier is not available for this project… set up billing". Earlier the same day the key worked. Not known: whether it is temporary, whether my test volume played a part, and whether the proxy's key (if it is the same Google project) is affected — the hourly limit prevented checking. If it is, the shared mode now lives on the fallbacks (403 moves on to OpenRouter and Workers AI). The app now explains this case in its own words instead of "wrong key".
- Confirmed by the owner in Google AI Studio: "free tier unavailable" for that whole project; Google gives no reason. He put a free key of another, older project of his into the proxy (`wrangler secret put GEMINI_API_KEY`). Checked: `gemini-3.5-flash-lite` answers in 1.8 s, `gemini-3.1-flash-lite` in 1.2 s; `gemini-3.6-flash` timed out after 45 s and the chain went on correctly. The two big models are therefore removed from the default list (`FALLBACK_MODELS` = `gemini-3.1-flash-lite`) — deployed and checked the same evening. Open risk: the new project can be restricted the same way; then the shared mode runs on OpenRouter (50 requests a day) and Workers AI.
- Google's terms: only the paid tier may be used when the app is made available to users in the EEA, Switzerland or the UK.
- My live tests used up the owner's 5 prompts per hour again. Live tests of the shared mode need a separate test allowance (for example an invite/admin switch), not the owner's own.


## Done on 2026-11-18 (late)

- **Guided tour** (`agent/src/app/tour.tsx`): four steps on the home page (tools, AI agent, Recent changes, Settings), each lights up its element; shown once on the first visit, "Show the short tour again" in Settings; Esc/Enter/arrows work; four languages. Checked live on Linux. The owner's own Spotify had the tour marked as seen after my test, so he sees it only from Settings.
- **Newer Spotify:** instead of stopping, both installers explain and ask "Try anyway?" (Enter = yes); `--force` / `-Force` skips the question; with nobody to ask they stop as before.
- **Installer messages in four languages** for what a person must understand (questions, errors, the last line); progress lines stay English. Language from the system, `SPOTIFY_AI_LANG` overrides. Texts live in `scripts/dev/installer-texts.json` and are generated into both scripts (`gen-installer-texts.py`; CI fails when they are out of date). `install.ps1` stays ASCII: its texts are `\uXXXX` escapes. Printing Cyrillic in a real Windows console was not looked at by a person.
- **Daily watch** (`.github/workflows/watch.yml`): every day the full install test runs on Windows and macOS with that day's Spotify. On failure it runs once more with force, compares the pinned Spicetify with the latest release, and opens (or updates) an issue labelled `watch` that says what it means and what to do; when the test passes again the issue is closed. First run passed. GitHub switches scheduled workflows off after 60 days without commits in the repository.
- README: no "working title"; ready commands for every option.

Wanted by the owner, not started — see "Next big things" below.

## Appearance: foundation only (2026-11-18, late)

- Written: `agent/src/core/` (the startup extension, 1.1 KB built), `agent/theme/` (`color.ini` with stock colours, `user.css`), build steps that put them into `agent/release/` (decision 30).
- **Applied by hand on the owner's Linux only** (`current_theme spotify-ai`, `inject_css 1`, `replace_colors 1`, extension added). **The installers do not know about it yet**: a run of `install.sh` switches the colour replacement off again (the extension then does nothing).
- Checked live: with no look saved, Spotify looks the same as before (library, track list and bars identical in a before/after picture); a trial look applied through the extension recolours the whole client at once and is removed cleanly.
- **Cost measured (same machine, same evening, music stopped; labels `look-on` / `look-off` in `docs/perf/results.jsonl`):** startup until settled 13.57 s with the look parts on, 13.58 s with them off; CPU time spent starting 18.3 s vs 19.7 s; CPU paused 1.18 % vs 1.22–1.47 % of one core (one "off" window had an unrelated spike of 41 %); RAM paused 1085 MB vs 1073 MB (+1 %). No difference outside the noise. The earlier record `look-before` was taken while music played through the web player (the client then burns about one core by itself) and is useless.
- **Open, not caused by this change:** startup "until settled" is about 13.6 s in both configurations, against 5.9–6.5 s in the baseline of 2026-11-17. What changed since then is not known (candidates: the "Now playing" panel with its looping video being open, the session with the web player, the bigger Spotify window).
- **Appearance page, part 1 (done, Linux only):** card "Appearance" (shown only where Spotify is set up for looks); nine ready-made looks plus "Spotify"; your own accent and background (each a swatch, a hex field and three sliders — no system colour dialog is used); a gradient of 2–4 colours with direction and strength. The whole palette is derived from background + accent (`agent/src/app/look.ts`, tested for readable contrast on dark and light backgrounds). A gradient is painted on the page and the three big panels get see-through colours, so no Spotify class names are touched. Every change shows at once, is saved, and is applied at the next start by the extension (1.3 KB). Checked live: presets, a slider, reset, survival across a normal restart. A look changed seconds before Spotify is killed can be lost (Spotify had not stored it yet).
- Seen and left for part 2: Spotify paints playlist headers in a colour taken from the cover, whatever the look.
- Not done: the three full themes (one black and white), the installers for all three systems (**until then the card does not appear for anyone but the owner**), the cost of an active gradient, what happens to a user's own Spicetify theme.

## Next big things (asked for on 2026-11-18)

- **Appearance:** a colour/gradient customiser with presets, and three full themes that restyle Spotify, one of them black and white. This needs code and styles loaded when Spotify starts, which the current design avoids on purpose (decision: nothing runs at startup, `inject_css 0`); the owner must agree to that trade first.
- **A fairer shuffle** for big playlists (his 1,200-track playlist keeps repeating the same songs).
- **Animated playlist covers (GIF):** Spotify's servers accept only still images for covers, so this can only be a local effect in the owner's own client.


## Phase 5 — in progress

1. Research: how to install on Windows and macOS without SpotX — done. Result: versioned installers cannot be downloaded from Spotify's servers (signed links); the installer will accept the current official Spotify, check it against the supported ceiling (1.3.9 for Spicetify 2.46.7) and stop with a clear message if it is newer (expected gap 0–6 days). Update blocking: `chflags uchg` on the Update folder (macOS), a locked `Update` file (Windows); Spicetify's own command is broken on Windows. Asset names and checksums for Spicetify 2.46.7 on both systems are known.
2. Security review — done, see above.
3. Fix what the review finds — done; the hardened proxy is deployed and checked.
4. `install.ps1` (Windows) and macOS support in `install.sh` — written. The manual workflow `installer-smoke` ran both on GitHub's machines (Windows Server with PowerShell 5.1; macOS 26 on Apple Silicon): Spotify installed from Spotify's server, patched, re-run as a repair with a changed switch, installed again through the "paste one command" way, uninstalled; the update block could not be deleted or written into; patched Spotify started on macOS.
   - **Found:** the official Spotify is 1.3.10 since about 2026-11-18, Spicetify 2.46.7 supports up to 1.3.9. Without `-Force` / `--force` both installers stop at the version check, as designed. The run above used the force option: Spicetify patched 1.3.10 without an error, but nobody has looked at the interface, so `SPOTIFY_MAX` stays 1.3.9.
   - **Not covered by the machine test:** what the interface looks like, whether ads are blocked, whether the update block really stops an update, the Microsoft Store path, the "App Management" refusal on macOS, Intel Macs, Windows on ARM, SmartScreen on `install.cmd`, a non-administrator Windows user (the test machine runs as administrator).
   - The download way (`raw.githubusercontent.com`) works only when the repository is public; until then test from a downloaded ZIP of the repository (`install.cmd` in it uses the files next to it).
   - First run by the owner on Windows (2026-11-18, the pasted command): Spotify was installed, then the installer stopped at the version check (1.3.10 > 1.3.9), as designed. Then with `-Force`: full install on Spotify 1.3.10, interface, translation and all functions fine. `SPOTIFY_MAX` raised to 1.3.10 (macOS on 1.3.10: patched and started on the CI machine, interface not seen by a person).
   - Windows Defender blocked the pasted command of the form `& ([scriptblock]::Create((irm …))) -Force` before PowerShell even started (the plain `irm … | iex` form ran fine on the same machine). That form is no longer used anywhere: `uninstall.cmd` and the pasted way pass options through environment variables. Checked by the owner (2026-11-18): `install.cmd` and `uninstall.cmd` from release v0.1.1 work and Defender stays quiet, but **Smart App Control** (Windows 11) blocks any downloaded `.cmd` outright, with no way to allow it. So the README now puts the pasted command first (it ran on the same machine) and keeps the double-click files as the second way. The pasted uninstall command (`$env:SPOTIFY_AI_UNINSTALL='1'; irm … | iex`) has not been run by a person yet. The first prompt in shared mode failed with Google's "model is experiencing high demand" (HTTP 503) — see "Overloaded model" below.
   - When `install.cmd` or `uninstall.cmd` change, upload them to a new release: the README links the latest release.
   - **Modified Spotify (2026-11-18):** on first install both installers check the existing Spotify. macOS: code signature (must be Spotify's and intact). Windows: signatures of `Spotify.exe`, `Spotify.dll`, `chrome_elf.dll` and known leftovers of other mods (`dpapi.dll`, `version.dll`, `config.ini`, `*.bak`, missing `xpui.spa`). When it is not original they say why, name the risks, and offer a clean copy (the login is kept). Machine-tested on both systems: a planted foreign file is noticed and the clean copy is installed; an untouched Spotify is reported as original. The Windows list of leftovers comes from memory of how those mods work, not from testing them — a real SpotX or BlockTheSpot install was not tried.
   - **Uninstall now really restores the original:** Spicetify's restore deletes `Apps/native-licenses.html`; the installers keep a copy and return it. On macOS the signature is valid again after uninstall (machine-tested). On the owner's Linux that file was already lost by earlier runs.
   - **First run by a person on macOS (the owner's friend, Apple Silicon, 2026-11-18):** found three faults, all fixed the same evening. (1) The signature check failed falsely: `codesign … | grep -q` under `pipefail` fails on machines where grep closes the pipe before codesign has finished writing; all such pipelines are gone. (2) Because of the order of steps, the existing Spotify was deleted before the new one was verified, and the Mac was left without Spotify; now the new copy is downloaded, checked and copied first. (3) After a successful install macOS said "Spotify is damaged and can't be opened": the app carried the quarantine mark (his terminal marks what it creates) and its signature no longer matches after patching; the installer now clears that mark after installing and after patching. Also: the `[Y/n]` hint was invisible and the text too long. The machine test now plants a quarantine mark and checks that a repair run clears it and Spotify starts. Confirmed on that Mac the same evening: the install works, Spotify opens, the app works. One more fault found there and fixed: the Settings button could not be clicked, because on macOS the top strip of the main view drags the window (the page now opts out with `-webkit-app-region: no-drag`) — confirmed working. Not reported back yet from the Mac: ads, uninstall, the "modified Spotify" question with a real mod.
5. Final README, last check of the history, create the release, then make the repository public — only after the owner says yes.

## Waiting on the owner

- A run of the Windows installer on his own machine (dual boot) and of the macOS one by his friend, with a look at the interface and the ads.
- When Spicetify supports Spotify 1.3.10: raise `SPOTIFY_MAX` (and the Spicetify version if a new one is needed).
- The three checks listed under "Not verified yet" that only he can do (ads after switching off, language filter on the big playlist, stats on the phone).
