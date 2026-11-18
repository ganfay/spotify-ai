# Status

Last update: 2026-11-17

## Current phase

**Phases 0–3 done (2026-11-18).** Linux only. Next: Phase 4 (toggles), then Phase 5 (Windows, macOS, security review, going public).

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
2. Phase 2, steps 2.1–2.4 done: API probes ([API_PROBE.md](API_PROBE.md)), Spotify adapter (`agent/src/spotify/`), snapshots + undo (`agent/src/snapshots.ts`, live test `agent/test/live-undo.ts` passes 4 scenarios), custom app with a home screen of feature cards (`agent/src/app`); Spicetify adds the top-bar button itself, so the app runs no code at Spotify startup. Build: `cd agent && npm install && npm run install-app`, then `spicetify config custom_apps ai-playlists && spicetify apply`.
3. Fix the benchmark's playing test (fixed track, fixed panel state) — see the last section of [perf/BASELINE.md](perf/BASELINE.md); agent app idle cost: startup / paused CPU / RAM pass, playing CPU inconclusive (not caused by the agent).
3a. Steps 2.5–2.7 done in code:
   - duplicates feature (`agent/src/features/duplicates.ts`);
   - AI agent: provider adapters (`agent/src/llm/`: Gemini via proxy or own key, Anthropic, OpenAI-compatible = OpenAI / xAI Grok / OpenRouter / custom address), tools that only read and propose (`agent/src/agent/tools.ts`), loop (`loop.ts`), proposals applied on click (`proposals.ts`), chat UI + settings (`agent/src/app/`); 16 unit tests; end-to-end run inside Spotify against a scripted local model passed (also proves external `fetch` is not blocked by Spotify);
   - Cloudflare Worker proxy (`worker/`, 40 tests): fixed model, limits per install id (5 prompts/hour), per-IP new-install cap, global daily cap, kill switch, optional invite mode. **Deployed on 2026-11-18** at the address in `agent/proxy-url.txt`; verified with real requests (Gemini answers through it, counter decreases, model override and foreign origins are rejected). `ADMIN_TOKEN` is not set, so admin routes are off.
3b. Verified with a real model: Gemini with the owner's own key (he ran the agent on a 400-track playlist) and Gemini through the proxy (curl). Anthropic and OpenAI-compatible adapters are still tested only against scripted responses.
3c. Steps 2.8–2.11 done in code (2026-11-18): the agent has `get_track_data` (Spotify's language of performance + mood numbers, cached, 80 tracks in ~7 s), `recommend_tracks`, `search_tracks` and `propose_additions`; all six home cards work (AI ones open the agent with a ready-made request for the chosen playlist). 19 unit tests.
3d. Live checks with the real model: recommendations for a 9-track playlist returned 5 picks with reasons in 7 s; the owner ran a mood split on a 400-track playlist earlier. **Not yet checked live:** language filter and cleanup after the new data tool, quality of results on big playlists, `Add to playlist` + undo for recommendations (covered by the snapshot test only indirectly).
3e. Known rough edges: the agent returned 5 recommendations where 10–20 were asked for; taste of mood splits needs tuning (owner's note); the agent stops politely when the model goes in circles (max 16 steps).
4. `install.sh` installs the agent app too, from the prebuilt copy in `agent/release/` (refresh it with `cd agent && npm run release` and commit).
4a. Phase 3 done: interface in English, Ukrainian, Russian and German (`agent/src/app/i18n.ts`, 163 texts each; default = Spotify's language, changeable in Settings); home cards with icons and a staggered entrance + hover animation; proposal cards with a kind label, select all / none, and a split editor (rename groups, move tracks between groups); progress bar for long reads; Stop button; covers and click-to-play with a pause state that follows the real player. 23 unit tests + end-to-end checks in the client.
4b. Small things left: the track count on a playlist tile can differ from the real count by 1–2 (Spotify's cached number); Spotify adapter error texts and provider key hints are English only; the agent's taste for mood splits and the number of recommendations still need tuning.
5. Before Phase 5: research how to install a pinned Spotify version on Windows/macOS without SpotX.

## Blockers / open questions

- Q4 (how the proxy identifies users) — open, needed only in Phase 2.
- Step 1.4 done: stats work with the current `spotify-adblock` config (known-good rollback point). Tests run on the owner's main account by his decision (ban risk explained and accepted).
- If variant B wins: how to install a pinned Spotify version on Windows/macOS without SpotX (see PLAN.md, Phase 5).
