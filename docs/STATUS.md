# Status

Last update: 2026-11-17

## Current phase

**Phase 0 — research and plan.** No code yet.

## Done

- Repo skeleton: `README.md`, `docs/IDEA.md`, `docs/DECISIONS.md`, `docs/STATUS.md`, `.gitignore`.
- Local facts checked on the Linux dev machine:
  - Spotify `1.3.4.258` from the official apt repo, installed in `/usr/share/spotify` (root-owned).
  - No flatpak and no snap Spotify is installed (only a leftover flatpak config folder).
  - Spicetify is not installed.
  - Current ad blocker: `abba23/spotify-adblock` via `LD_PRELOAD`, with a user config that does not block `gabo-receiver-service`.

## In progress

- Phase 0 research (SpotX, Spicetify, fallback ad blockers, existing AI playlist tools, Gemini + Cloudflare, proxy identity, performance measurement).

## Next

- Research report → `docs/RESEARCH.md`.
- Plan with phases, acceptance criteria, risks → `docs/PLAN.md`, then wait for approval.
- Create the GitHub repo (name and visibility to be confirmed).

## Blockers / open questions

- GitHub repo name and whether it starts private.
