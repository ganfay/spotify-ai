# Status

Last update: 2026-11-17

## Current phase

**Phase 1 — ads + stats on Linux.** Plan approved on 2026-11-17. Steps 1.1–1.2 done: baseline measured ([perf/BASELINE.md](perf/BASELINE.md)). Step 1.3 done: backup + [ROLLBACK.md](ROLLBACK.md).

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

1. Step 1.5: `sudo apt-mark hold spotify-client` (owner runs it).
2. Step 1.6: SpotX-Bash at the pinned commit (`versions`), flags `--noninteractive -e` (owner runs it, needs sudo).
3. Step 1.7: ad test (60 min), stats check on the phone, benchmark label `spotx`.

## Blockers / open questions

- Q4 (how the proxy identifies users) — open, needed only in Phase 2.
- Step 1.4 done: stats work with the current `spotify-adblock` config (known-good rollback point). Tests run on the owner's main account by his decision (ban risk explained and accepted).
- If variant B wins: how to install a pinned Spotify version on Windows/macOS without SpotX (see PLAN.md, Phase 5).
