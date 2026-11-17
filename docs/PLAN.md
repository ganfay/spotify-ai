# Plan

Status: **approved on 2026-11-17** (Q1, Q2, Q5 as recommended; Q3 replaced — see decision 14 in [DECISIONS.md](DECISIONS.md); Q4 still open, needed only in Phase 2). Based on [RESEARCH.md](RESEARCH.md).

## Decisions asked before Phase 1 (answers are recorded in DECISIONS.md)

| # | Question | Recommendation | Why |
|---|---|---|---|
| Q1 | SpotX turns on a client-side "premium" state together with ad blocking; it cannot be separated. The fallback (adblockify) does the same. Accept? | **Accept, and say it honestly in the README.** | No maintained cross-platform blocker works without it. The only "ads only" tool is `spotify-adblock` (Linux only). Server-side premium features (downloads, quality) stay locked. |
| Q2 | SpotX + Spicetify is an unsupported combination. Keep three layers, or test a two-layer variant (Spicetify + adblockify, no SpotX) as an equal candidate? | **Test both on Linux in Phase 1, then choose by results.** | Two layers = simpler installer, no patched binary, no third-party download server on Windows, a real on/off toggle for ad blocking. But adblockify is unproven on 1.3.4+. One extra test session decides it with facts. |
| Q3 | Gemini key owner must be 18+, and the free tier may not serve friends in the EU. | **Build the LLM layer so the provider is replaceable; develop Phase 2 against recorded/fake LLM answers and, optionally, a local model; connect Gemini when a key can be created under the terms. Decide free vs paid then.** | No rule is broken, and no work is blocked: most of Phase 2 (Spotify adapter, tools, preview, undo, UI, Worker) does not need a live key. |
| Q4 | How does the proxy know the user? | **Per-friend invite code inside the personal install command + a global daily cap + kill switch.** | Hard to fake, revocable, the friend types nothing. A Spotify ID is trivial to fake; forwarding the Spotify token breaks the "no credentials" promise. |
| Q5 | License for our code. | **MIT.** | Same as SpotX, adblockify and Spicetify Marketplace; simplest for a hobby project. |

## Proposed additions to DECISIONS.md (after approval)

- Use only internal client APIs (`Spicetify.Platform.*`, `spclient`, GraphQL); never `api.spotify.com/v1` (returns 429). All of them go through **one adapter module** with feature detection, so a Spotify update breaks one file, not the whole agent.
- **The LLM never gets a tool that changes data.** Its tools only read and *propose*. Changes are applied by our code after the user's click.
- Agent packaging: Spicetify **custom app** (code loads only when its page is opened) + a tiny startup script that only adds a button. Build with esbuild.
- Pin every external version in one file (`versions`): Spotify version, SpotX-Bash commit SHA, Spicetify version, adblockify commit SHA.
- Linux update blocking: `apt-mark hold spotify-client`.
- Windows SpotX flags (Phase 5): `-v <pinned>`, `-sendversion_off`, `-defender_exclusions_off`, `-block_update_on`.
- Proxy storage: one SQLite-backed Durable Object (exact counters); model fixed server-side to `gemini-3.5-flash-lite`.

## Phase 1 — ads + stats on Linux

Each step that touches the system is announced first and is reversible.

| Step | What | System change | Undo |
|---|---|---|---|
| 1.1 | Write the benchmark script (`scripts/bench/`). Measure it twice on the current setup to learn the noise level. | none | — |
| 1.2 | **Baseline:** stock Spotify (no `LD_PRELOAD`, ads will play) — RAM, idle CPU paused/playing, startup. Save to `docs/perf/`. | none | — |
| 1.3 | **Backup:** copy `/usr/share/spotify/Apps`, checksums of the binary, the `spotify-adblock` config and launcher into `backups/` (git-ignored). Write `docs/ROLLBACK.md`. | none | — |
| 1.4 | Before switching: confirm on the phone that stats work with the current fixed `spotify-adblock` config (this becomes the known-good rollback). | none | — |
| 1.5 | `sudo apt-mark hold spotify-client` | package hold | `apt-mark unhold` |
| 1.6 | **Variant A:** SpotX-Bash at a pinned commit, `--noninteractive -e`. Launch Spotify with the normal launcher (without `spotify-adblock`). | patches `/usr/share/spotify` (needs sudo) | `spotx.sh --uninstall` or `apt install --reinstall spotify-client` |
| 1.7 | Test A: 1 hour of listening (ads), "Recently played" on the phone, benchmark. Next day: "Listening stats". | none | — |
| 1.8 | Add Spicetify on top (`chmod a+wr` on the Spotify folder, `spicetify backup apply`). Repeat a short ad test + benchmark. | folder permissions, patched `Apps/` | `spicetify restore`, `chmod` back |
| 1.9 | **Variant B** (if Q2 = test both): restore stock → Spicetify + adblockify only. Same tests. | as 1.8 | as 1.8 |
| 1.10 | Choose the variant. Record it in DECISIONS.md. | — | — |
| 1.11 | **Installer v0 for Linux** (`install.sh`): detects the current state, runs restore → ad blocker → Spicetify in the right order, safe to re-run, has `--uninstall`. | — | `--uninstall` |

**Acceptance criteria**

- **Ads:** 0 audio ads and 0 visual ads in 60 minutes of continuous listening on a free account.
- **Stats:** a played track is in "Recently played" on the phone within 10 minutes; on the next day it is counted in "Listening stats".
- **Performance vs stock baseline** (median of 5 runs):
  - RAM: not more than +10 %;
  - idle CPU (paused and playing): not more than +0.5 percentage points of one core;
  - startup: not more than +15 %.
  - If the measured noise between two identical runs is bigger than a margin, that margin becomes 2 × noise.
- **Reversibility:** `--uninstall` returns the client to stock (file checksums equal the backup).
- **Repair:** running the installer twice in a row ends in the same working state.

## Phase 2 — primitive agent

Order is chosen so that the riskiest unknowns are tested first.

| Step | What | Done when |
|---|---|---|
| 2.1 | **API probe:** a small script run in the client's developer console that checks every internal call from RESEARCH.md §2 on the real client. | A table "call → works / shape / limit" in `docs/`. |
| 2.2 | **Spotify adapter:** read playlists, tracks, liked songs; create playlist; add / remove / move; search; lyrics; similar tracks. | Works on a 2,000-track playlist without errors or throttling. |
| 2.3 | **Snapshots + undo:** before any write, save the playlist (track list and order) locally; undo restores it exactly. | Undo after each kind of change gives an identical playlist. |
| 2.4 | **Custom app shell:** button + page with an input field; nothing else loads at startup. | Benchmark with the app installed but closed is inside Phase 1 margins. |
| 2.5 | **Feature 1 — duplicates** (mostly plain code: ISRC, normalised title + artist, duration; LLM only for unclear pairs). | Preview list with checkboxes → new playlist or confirmed removal → undo. |
| 2.6 | **LLM layer + agent loop** (tools, chunked structured output, validation of every answer). | Works against recorded answers and one real provider. |
| 2.7 | **Worker proxy:** invite codes, per-user and global daily caps, kill switch, fixed model, CORS; own-key mode in the client. | Limits proven by tests; no key in the repo (secret scan in CI). |
| 2.8 | **Feature 4 — cleanup** (tracks that don't fit, with a reason each). | Tick → confirm → remove → undo. |
| 2.9 | **Feature 2 — language filter:** letter cues → LLM with artist knowledge → lyrics for unclear ones → "unsure" bucket for the user. | On a mixed Ukrainian/Russian test playlist: no Ukrainian track is dropped silently. |
| 2.10 | **Feature 3 — split** by mood / genre / energy (audio features + LLM). | Every track lands in exactly one proposed group; groups are editable before creation. |
| 2.11 | **Feature 5 — recommendations:** candidates from Spotify's own similar-track sources + LLM suggestions verified by search; LLM ranks and explains. | Each recommended track exists, is not already in the playlist, and has a reason. |

**Acceptance:** all five features work on real playlists (≥ 500 tracks); no write happens without a click; undo always restores; idle cost within Phase 1 margins; proxy limits hold.

## Phases 3–5 (outline)

- **Phase 3 — UI:** side panel or page with conversation, proposals as cards, progress for long jobs, clear error messages.
- **Phase 4 — settings:** own-key field; ad blocking on/off (with SpotX this means re-running the installer, with adblockify it is a real toggle); telemetry — document exactly what is blocked; a toggle only if technically honest.
- **Phase 5 — Windows + macOS installers**, README (install, uninstall, credits, privacy note, risk note), tested version set, releases. Needs access to a Windows and a macOS machine (or friends as testers).
  - Cross-platform check of the variant chosen in Phase 1: the same 60-minute ad test and stats test on each OS (decision 13).
  - Open point if variant B (no SpotX) wins: how to install a *pinned* Spotify version on Windows/macOS. The official installer always gives the newest client, which Spicetify may not support yet for days or weeks. SpotX solves this itself; without it we need our own answer (to research then).

## Risks

| Risk | Likelihood | Impact | What we do |
|---|---|---|---|
| Spotify update breaks SpotX / Spicetify / internal APIs | high (over months) | high | Updates blocked; pinned tested version set; one adapter module; installer repairs. |
| SpotX does not block ads on this version (issue #146) | medium | high | Variant B tested in the same phase. |
| Stats break again after a future patch change | medium | medium | Stats check is part of every version bump checklist. |
| Account action by Spotify (Terms of Use forbid client mods, ad blocking, feeding content to AI) | low so far, not zero | high | Honest risk note in README; friends decide themselves; no mass automation, gentle request rates. |
| Repo takedown (DMCA) | low–medium | medium | We host no Spotify files and no third-party code; installer only downloads from official repos. |
| Stranger drains the Gemini quota | medium once public | low–medium | Invite codes, global cap, kill switch, spend cap. |
| LLM returns wrong or invalid data | high | medium | Validate every answer, chunking, "unsure" bucket, nothing applied without preview. |
| Undocumented API silently changes data wrongly | low | high | Snapshot before every write; default = new playlist; verify after write. |
| Spicetify v3 changes the packaging | medium (next year) | medium | Pin v2; keep Spicetify-specific code thin. |
| Windows friends distrust Defender exclusions / third-party download | medium | medium | Disable with flags; explain in README; or two-layer variant (no SpotX). |

## What Maks does by hand

- Enters the `sudo` password when a step needs it (each such step is announced first).
- Listening tests: 1 hour on a free account; phone checks of "Recently played" and next-day "Listening stats".
- Later: creates the Cloudflare account and the Gemini key and sets the key as a Worker secret (never pasted into a chat).
- Finds a Windows and a macOS tester for Phase 5.
- Answers Q1–Q5 above.
