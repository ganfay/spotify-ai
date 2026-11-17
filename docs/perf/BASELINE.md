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
