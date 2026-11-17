# Status

Last update: 2026-11-17

## Current phase

**Phase 0 — research done, plan waiting for approval.** No code yet.

## Done

- Repo skeleton: `README.md`, `docs/IDEA.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `.gitignore`.
- Private GitHub repo `ganfay/spotify-ai` created; commits use the GitHub no-reply address.
- Phase 0 research → [RESEARCH.md](RESEARCH.md).
- Proposed plan → [PLAN.md](PLAN.md).
- Local facts checked on the Linux dev machine:
  - Spotify `1.3.4.258` from the official apt repo, installed in `/usr/share/spotify` (root-owned).
  - No flatpak and no snap Spotify is installed (only a leftover flatpak config folder).
  - Spicetify is not installed.
  - Current ad blocker: `abba23/spotify-adblock` via `LD_PRELOAD`, with a user config that does not block `gabo-receiver-service`.
  - cgroup v2 is available and Spotify runs in its own scope → performance can be measured without extra tools.

## Next

1. Answers to Q1–Q5 in [PLAN.md](PLAN.md) and approval of the plan.
2. Record the approved decisions in `DECISIONS.md`.
3. Phase 1, step 1.1: benchmark script and baseline.

## Blockers / open questions

- Plan approval (Q1–Q5).
- Gemini API terms require the key owner to be 18+ and forbid the free tier for users in the EEA / Switzerland / UK — see Q3.
- Stats check on the phone with the current `spotify-adblock` config is still pending (needed as a known-good rollback point).
