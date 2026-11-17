# Decisions

One entry per decision: what was decided and why. Newest at the bottom. A decision is changed only by adding a new entry that replaces the old one.

Status: **accepted** (decided), **proposed** (waiting for approval), **replaced**.

| # | Date | Decision | Why | Status |
|---|---|---|---|---|
| 1 | 2026-11-17 | Three layers: SpotX / SpotX-Bash → Spicetify → our agent, installed by one command per OS. | Reuse maintained tools for ad blocking and modding; write only the agent ourselves. | accepted |
| 2 | 2026-11-17 | SpotX and Spicetify are downloaded by the installer from their official repos, never copied into this repo. | License safety and easy updates. | accepted |
| 3 | 2026-11-17 | Spotify data is accessed only through the user's own in-client session. No Spotify developer app. | Verified: Web API development mode allows 5 users per app and needs Premium; extended quota needs a registered business with ≥ 250k monthly active users. | accepted |
| 4 | 2026-11-17 | LLM = Google Gemini, two modes: default through our Cloudflare Worker proxy (key stays in the Worker, per-user limits); optional own key with direct calls. | Users need no key; the key is never in the repo or the client. | accepted |
| 5 | 2026-11-17 | Spotify auto-updates are blocked; we move manually to a tested version. | Client updates break patches. | accepted |
| 6 | 2026-11-17 | A Spicetify-level ad blocker is written/adapted only if SpotX fails the Phase 1 tests. | Avoid duplicate work. | accepted |
| 7 | 2026-11-17 | Any ad blocker must not block playback-event endpoints (`gabo-receiver-service` etc.). | Blocking it killed listening stats with `spotify-adblock`. | accepted |
| 8 | 2026-11-17 | Agent rule: it proposes, the user approves. Default output is a new playlist. Destructive actions need preview + confirmation + snapshot for undo. | Playlists are personal data built over years; mistakes must be cheap to reverse. | accepted |
| 9 | 2026-11-17 | Idle = zero background work (no timers, no polling, no heavy DOM observers); heavy code loads only when the agent is opened. | Priority 3: performance ≈ stock Spotify. | accepted |
| 10 | 2026-11-17 | iOS is out of scope. | No legitimate way to modify the iOS app. | accepted |
| 11 | 2026-11-17 | GitHub repo `ganfay/spotify-ai` starts private; it becomes public only after a check for secrets and personal data in the history. Commits use the GitHub no-reply e-mail. | Keep personal and university addresses out of a public history that cannot be cleaned later. | accepted |

Decisions proposed by the Phase 0 research are listed in [PLAN.md](PLAN.md) and move here once approved.
