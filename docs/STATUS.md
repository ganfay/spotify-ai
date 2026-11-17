# Status

Last update: 2026-11-17

## Current phase

**Phase 1 — ads + stats on Linux.** Plan approved on 2026-11-17. Steps 1.1–1.2 done: baseline measured ([perf/BASELINE.md](perf/BASELINE.md)). Steps 1.3–1.6 and 1.8 done: backup, update hold, SpotX-Bash, Spicetify on top; variant A passes all performance criteria.

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

1. Step 1.7 for variant A: 60-minute ad test and phone stats check (owner).
2. Step 1.9: variant B (restore stock → Spicetify + adblockify), same tests.
3. Step 1.10–1.11: choose the variant, installer v0.

## Blockers / open questions

- Q4 (how the proxy identifies users) — open, needed only in Phase 2.
- Step 1.4 done: stats work with the current `spotify-adblock` config (known-good rollback point). Tests run on the owner's main account by his decision (ban risk explained and accepted).
- If variant B wins: how to install a pinned Spotify version on Windows/macOS without SpotX (see PLAN.md, Phase 5).
