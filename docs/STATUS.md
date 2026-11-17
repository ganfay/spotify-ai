# Status

Last update: 2026-11-17

## Current phase

**Phase 1 — ads + stats on Linux: almost done.** Variant B (Spicetify + adblockify) chosen (decision 22). `install.sh` v0 works: fresh install and repeat run tested. Full cycle `--uninstall` → install tested by the owner, including the sudo steps. Open: stats check on the phone.

## Done

- Repo skeleton: `README.md`, `docs/IDEA.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `.gitignore`.
- Private GitHub repo `ganfay/spotify-ai` created; commits use the GitHub no-reply address.
- Phase 0 research → [RESEARCH.md](RESEARCH.md).
- Plan → [PLAN.md](PLAN.md), approved; decisions 12–21 recorded in [DECISIONS.md](DECISIONS.md).
- MIT `LICENSE` added.
- Benchmark tool `scripts/bench/bench.py` + protocol in [perf/README.md](perf/README.md).
- Local facts checked on the Linux dev machine:
  - Spotify `1.3.4.258` from the official apt repo, installed in `/usr/share/spotify` (root-owned).
  - No flatpak and no snap Spotify is installed (only a leftover flatpak config folder).
  - Spicetify is not installed.
  - Current ad blocker: `abba23/spotify-adblock` via `LD_PRELOAD`, with a user config that does not block `gabo-receiver-service`.
  - cgroup v2 is available and Spotify runs in its own scope → performance can be measured without extra tools.

## Next

1. Owner: check "Recently played" / "Listening stats" on the phone for variant B.
2. Phase 2, steps 2.1–2.4 done: API probes ([API_PROBE.md](API_PROBE.md)), Spotify adapter (`agent/src/spotify/`), snapshots + undo (`agent/src/snapshots.ts`, live test `agent/test/live-undo.ts` passes 4 scenarios), custom app shell with a top-bar button (`agent/src/app`, `agent/src/extension`). Build: `cd agent && npm install && npm run install-app`, then `spicetify config custom_apps ai-playlists && spicetify apply`.
3. Fix the benchmark's playing test (fixed track, fixed panel state) — see the last section of [perf/BASELINE.md](perf/BASELINE.md); agent app idle cost: startup / paused CPU / RAM pass, playing CPU inconclusive (not caused by the agent).
3a. Next feature: step 2.5 duplicates (plain code + preview UI), then 2.6 LLM layer and 2.7 Worker (needs Q4 answer).
4. `install.sh` does not install the agent app yet (needs a prebuilt bundle, e.g. a GitHub release asset).
5. Before Phase 5: research how to install a pinned Spotify version on Windows/macOS without SpotX.

## Blockers / open questions

- Q4 (how the proxy identifies users) — open, needed only in Phase 2.
- Step 1.4 done: stats work with the current `spotify-adblock` config (known-good rollback point). Tests run on the owner's main account by his decision (ban risk explained and accepted).
- If variant B wins: how to install a pinned Spotify version on Windows/macOS without SpotX (see PLAN.md, Phase 5).
