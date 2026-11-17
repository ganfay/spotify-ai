# Baseline — 2026-11-17

Spotify 1.3.4.258 (apt), Ubuntu 26.04, 12 CPU threads, 14 GB RAM. Medians of 5 runs. Raw data: `results.jsonl`.

| Metric | `noise-a` (current ad blocker) | `noise-b` (same setup again) | `stock` (no ad blocker) |
|---|---|---|---|
| Startup until settled | 5.88 s | 6.54 s | **6.55 s** |
| CPU paused, % of one core | 0.58 | 0.61 | **1.86** |
| CPU playing, % of one core | 4.97 | 4.51 | **4.80** ¹ |
| RAM paused | 1108 MB | 1128 MB | **1136 MB** |
| RAM playing | 1138 MB | 1164 MB | **1160 MB** ¹ |

¹ Ads played during the `stock` playing test, so the record is marked `tainted`. That is what stock Spotify does on a free account, so it still is the baseline; use `report --baseline stock --include-tainted`.

## Noise (same setup measured twice)

| Metric | Difference `noise-a` vs `noise-b` | Margin | Margin used |
|---|---|---|---|
| Startup | 11 % | 15 % | 15 % |
| CPU paused | 0.03 pp | 0.5 pp | 0.5 pp |
| CPU playing | 0.46 pp | 0.5 pp | 0.5 pp (borderline — single windows vary from 4 % to 15 %) |
| RAM | 2 % | 10 % | 10 % |

## Notes

- Stock Spotify idles **higher** when paused (1.86 % vs 0.6 %): it has bursts of 5 % in some windows, most likely ad loading. So an ad blocker lowers idle CPU here.
- One `noise-a` startup run out of 15 never settled within 90 s (27 s of CPU instead of 9 s). Cause unknown; watch for repeats.
- RAM right after start is ~1.1–1.25 GB; a long-running session measured earlier the same day used ~615 MB. Always compare setups at the same age (the protocol does).
- Spotify ignores SIGTERM for a long time; the tool closes it with the MPRIS `Quit` command.

## SpotX-Bash only (`spotx`) — 2026-11-17

| Metric | `stock` | `spotx` | Verdict |
|---|---|---|---|
| Startup until settled | 6.55 s | 6.27 s | pass |
| CPU paused | 1.86 % | 0.76 % | pass |
| **CPU playing** | 4.80 % | **26.5 %** | **FAIL** (+21.7 pp) |
| RAM paused | 1136 MB | 1176 MB | pass (+3.5 %) |
| RAM playing | 1160 MB | 1222 MB | pass (+5.3 %) |

The extra CPU while playing is in the GPU process (~14 %) and one renderer (~12.5 %), stable in all 5 windows and in a repeat sample. That pattern means something is being drawn continuously (an animation or looping video in the UI), not audio work. Cause not identified yet — needs a look at the screen. Verified in the patched binary: only `gabo-receiver-service/public/…` is disabled, `gabo-receiver-service/v3/events/` is intact.

**Follow-up (same day):** the 26–30 % appears right after a fresh start + playback and was reproduced; after the owner interacted with the window it dropped to 3–9 % (normal). The old ad blocker did not show this with the same procedure. Root cause not found. **Owner's decision: not critical, accepted, move on.** Re-check when comparing with variant B.

## Variant A: SpotX-Bash + Spicetify 2.46.7 (`spotx-spicetify`) — 2026-11-17

Spicetify applied with `inject_css 0`, `replace_colors 0`, no extensions, no custom apps.

| Metric | `stock` | `spotx-spicetify` | Verdict |
|---|---|---|---|
| Startup until settled | 6.55 s | 6.27 s | pass (−4 %) |
| CPU paused | 1.86 % | 1.78 % | pass |
| CPU playing | 4.80 % | 4.10 % | pass |
| RAM paused | 1136 MB | 1088 MB | pass (−4 %) |
| RAM playing | 1160 MB | 1138 MB | pass (−2 %) |

**All performance criteria pass.** The 26–30 % playing CPU seen with SpotX alone did **not** appear here with the identical procedure (fresh start → playback by MPRIS). Why is unknown; possibly Spicetify's preprocessing removes whatever was animating.

Network check of the patched client while running: 7 TCP connections, all to Google Cloud addresses; 6 in the same block as `spclient.wg.spotify.com` / `api-partner.spotify.com`, one (104.199.65.9) not matched to a Spotify hostname. No third-party hosts seen (single snapshot).

## Variant B: Spicetify 2.46.7 + adblockify (`spicetify-adblockify`) — 2026-11-17

Stock client (checksums verified) + Spicetify (`inject_css 0`, `replace_colors 0`) + `adblock.js` at commit `5da6cf1`.

| Metric | `stock` | A: `spotx-spicetify` | B: `spicetify-adblockify` |
|---|---|---|---|
| Startup until settled | 6.55 s | 6.27 s | 6.55 s |
| CPU paused | 1.86 % | 1.78 % | 0.85 % |
| CPU playing | 4.80 % | 4.10 % | 4.07 % |
| RAM paused | 1136 MB | 1088 MB | 1117 MB |
| RAM playing | 1160 MB | 1138 MB | 1161 MB |

**Both variants pass all performance criteria**, and they do not differ beyond noise except paused CPU, where B is lower. No ad was detected during B's 5-minute playing test (stock had ads in every window) — a first hint, not the 60-minute test.
