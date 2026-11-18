# Status

Last update: 2026-11-18

A new chat should read this file first, then [DECISIONS.md](DECISIONS.md) and [PLAN.md](PLAN.md).

## Where we are

**Phases 0–4 are done. Linux only. Phase 5 is in progress** (Windows, macOS, security review, going public).

The repository `ganfay/spotify-ai` is still **private**.

## What exists and works (Linux, Spotify 1.3.4.258 from apt)

| Part | Where | State |
|---|---|---|
| Installer | `install.sh`, `versions` | One command. Holds the apt package, installs Spicetify 2.46.7, the ad blocker (adblockify at a pinned commit, checksum-verified, wrapped in a flag check) and the AI Playlists app. Re-running repairs. `--uninstall`, `--adblock on\|off`, `--block-reports on\|off`. Full cycle tested by the owner. |
| AI Playlists app | `agent/` (TypeScript, esbuild), prebuilt copy in `agent/release/` | Home with six cards, duplicate finder (no AI), AI agent with five features (duplicates, language filter, split by mood, clean-up, recommendations), Settings, "Recent changes" with Undo. Interface in English, Ukrainian, Russian, German. 23 unit tests. No code runs at Spotify startup. |
| Proxy | `worker/` (Cloudflare Worker, 40 tests) | Deployed by the owner; address in `agent/proxy-url.txt`. Holds the Gemini key as a secret. Limits: 5 prompts/hour per install id, cap on new installs per IP, global daily cap, kill switch. Invite mode exists, off. `ADMIN_TOKEN` not set → admin routes off. |
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

## Phase 5 — in progress

1. Research: how to install on Windows and macOS without SpotX (pinned Spotify version, unattended Spicetify, update blocking). *Running.*
2. Security review by an independent reviewer (secrets in history, Worker, client, prompt injection, installer, dependencies, honesty of the docs). *Running.*
3. Fix what the review finds.
4. Write `install.ps1` (Windows) and the macOS branch of the installer. **Needs testers with a Windows and a Mac machine** — none yet.
5. Final README, last check of the history, then make the repository public — only after the owner says yes.

## Waiting on the owner

- Testers for Windows and macOS.
- The three checks listed under "Not verified yet" that only he can do (ads after switching off, language filter on the big playlist, stats on the phone).
