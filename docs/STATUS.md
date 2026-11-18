# Status

Last update: 2026-11-18

A new chat should read this file first, then [DECISIONS.md](DECISIONS.md) and [PLAN.md](PLAN.md).

## Where we are

**Phases 0–4 are done and tested by the owner on Linux. Phase 5 is in progress:** security review done, Windows and macOS installers written and machine-tested, going public is left.

The repository `ganfay/spotify-ai` is still **private**.

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

## Phase 5 — in progress

1. Research: how to install on Windows and macOS without SpotX — done. Result: versioned installers cannot be downloaded from Spotify's servers (signed links); the installer will accept the current official Spotify, check it against the supported ceiling (1.3.9 for Spicetify 2.46.7) and stop with a clear message if it is newer (expected gap 0–6 days). Update blocking: `chflags uchg` on the Update folder (macOS), a locked `Update` file (Windows); Spicetify's own command is broken on Windows. Asset names and checksums for Spicetify 2.46.7 on both systems are known.
2. Security review — done, see above.
3. Fix what the review finds — done; the hardened proxy is deployed and checked.
4. `install.ps1` (Windows) and macOS support in `install.sh` — written. The manual workflow `installer-smoke` ran both on GitHub's machines (Windows Server with PowerShell 5.1; macOS 26 on Apple Silicon): Spotify installed from Spotify's server, patched, re-run as a repair with a changed switch, installed again through the "paste one command" way, uninstalled; the update block could not be deleted or written into; patched Spotify started on macOS.
   - **Found:** the official Spotify is 1.3.10 since about 2026-11-18, Spicetify 2.46.7 supports up to 1.3.9. Without `-Force` / `--force` both installers stop at the version check, as designed. The run above used the force option: Spicetify patched 1.3.10 without an error, but nobody has looked at the interface, so `SPOTIFY_MAX` stays 1.3.9.
   - **Not covered by the machine test:** what the interface looks like, whether ads are blocked, whether the update block really stops an update, the Microsoft Store path, the "App Management" refusal on macOS, Intel Macs, Windows on ARM, SmartScreen on `install.cmd`, a non-administrator Windows user (the test machine runs as administrator).
   - The download way (`raw.githubusercontent.com`) works only when the repository is public; until then test from a downloaded ZIP of the repository (`install.cmd` in it uses the files next to it).
   - The README links `install.cmd` / `uninstall.cmd` from the latest release: a release with these two files must be created when going public.
5. Final README, last check of the history, create the release, then make the repository public — only after the owner says yes.

## Waiting on the owner

- A run of the Windows installer on his own machine (dual boot) and of the macOS one by his friend, with a look at the interface and the ads.
- When Spicetify supports Spotify 1.3.10: raise `SPOTIFY_MAX` (and the Spicetify version if a new one is needed).
- The three checks listed under "Not verified yet" that only he can do (ads after switching off, language filter on the big playlist, stats on the phone).
