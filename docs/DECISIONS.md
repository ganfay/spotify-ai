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
| 12 | 2026-11-17 | Accept that ad blocking also switches the client to a "premium" product state (unlimited skips etc.). Said openly in the README. | SpotX and adblockify cannot block ads without it; server-side premium features stay locked. | accepted |
| 13 | 2026-11-17 | Phase 1 tests two variants on Linux: **A** = SpotX-Bash + Spicetify, **B** = Spicetify + adblockify (no SpotX). Rule: B is chosen if it passes all Phase 1 criteria (fewer layers); otherwise A. Before the Windows/macOS release the same ad + stats test runs on each OS; if the chosen variant fails on any OS, we switch all OSes to the other variant if it passes there. | SpotX authors do not support the combination with Spicetify; adblockify is unproven on new clients. One architecture for all platforms, decided by measurements. | accepted |
| 14 | 2026-11-17 | Gemini through the owner's existing free-tier key, held only in the Worker. Start limit: 5 prompts per user per hour (a Worker setting, easy to change). The LLM layer keeps a small provider interface. | Owner's decision. The README privacy note must say that free-tier requests may be used by Google for training. Replaces the "wait for a key" idea from Q3. | accepted |
| 15 | 2026-11-17 | License of our code: MIT. | Same as SpotX, adblockify and Spicetify Marketplace. | accepted |
| 16 | 2026-11-17 | Only internal client APIs (`Spicetify.Platform.*`, `spclient`, GraphQL); never `api.spotify.com/v1`. All access goes through one adapter module with feature detection. | The public Web API returns 429 to the in-client token. Internal APIs are undocumented, so breakage must stay in one file. | accepted |
| 17 | 2026-11-17 | The LLM never gets a tool that changes data. It reads and proposes; our code applies changes after the user's click. | Safety by construction (extends decision 8). | accepted |
| 18 | 2026-11-17 | Agent packaging: Spicetify custom app (code loads only when its page is opened) + a tiny startup script that adds a button. Build with esbuild. | Zero idle cost; `spicetify-creator` is deprecated. | accepted |
| 19 | 2026-11-17 | Every external version is pinned in one file: Spotify version, SpotX-Bash commit, Spicetify version, adblockify commit. | Upstream scripts are served from `main`; unpinned remote code can change under us. | accepted |
| 20 | 2026-11-17 | Linux update blocking: `apt-mark hold spotify-client`. | SpotX-Bash and Spicetify cannot block updates on Linux. | accepted |
| 21 | 2026-11-17 | Performance margins vs stock Spotify (median of 5 runs): RAM ≤ +10 %, idle CPU ≤ +0.5 percentage points of one core, startup ≤ +15 %; a margin smaller than the measured noise becomes 2 × noise. | Priority 3, made measurable. | accepted |
| 22 | 2026-11-17 | **Variant B is chosen: Spicetify + adblockify, no SpotX.** Variant A (SpotX-Bash + Spicetify) stays as the documented fallback. Replaces decision 1 (three layers) and the SpotX parts of 2, 6 and 19. | Both variants pass all performance criteria on Linux. B: 0 ads in 18 min of counted playback (stock showed an ad at minute 8), Spotify binary untouched, no third-party download server or antivirus exclusions on Windows, real on/off toggle, simpler installer. Known gaps: ad test was shortened from 60 min by the owner; stats check pending; pinned Spotify version on Windows/macOS without SpotX is unsolved (research before Phase 5). | accepted |

**Open:** how the proxy identifies users (Q4 in [PLAN.md](PLAN.md)) — needed only in Phase 2.
