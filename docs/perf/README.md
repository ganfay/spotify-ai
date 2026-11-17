# Performance measurements

Tool: [`scripts/bench/bench.py`](../../scripts/bench/bench.py) (Python 3, standard library only, Linux).
Raw results: `results.jsonl` in this folder (one JSON line per test).

## What is measured

| Metric | How | Why this way |
|---|---|---|
| **RAM** | Sum of `Pss` from `/proc/<pid>/smaps_rollup` over all Spotify processes, sampled every 5 s, median. | Spotify is ~10 processes that share memory. PSS counts shared memory once, so the sum is honest. |
| **Idle CPU** | CPU time of Spotify's cgroup (`cpu.stat` → `usage_usec`) over a 60 s window, as % of one core. Two states: paused and playing. | The kernel counts every Spotify process, including short-lived ones. |
| **Startup** | Time from launch until CPU use stays below 10 % of one core for 3 s ("settled"). Also logged: first window, media-player interface ready. | "Window exists" is too early — the UI is still loading. "Settled" is when the app is really usable. |

Each test runs 5 times; the report shows the median. The first startup run is a warm-up and is ignored.

## Protocol (same for every setup)

Before: laptop on AC power, no other heavy apps, same Spotify account, same window size.

```bash
# 1. Startup (restarts Spotify 6 times, ~3 min)
python3 scripts/bench/bench.py startup --label <label>

# 2. Paused: do not touch Spotify (~5 min)
python3 scripts/bench/bench.py steady --label <label>

# 3. Press play on the test track with repeat on, then (~5 min)
python3 scripts/bench/bench.py steady --label <label>

# 4. Compare everything with the baseline
python3 scripts/bench/bench.py report --baseline stock
```

`--cmd "<command>"` on the `startup` step sets how Spotify is launched (default: `spotify`).

If an ad plays or playback state changes during a `steady` test, the result is marked `tainted` and left out of the report.

## Labels

| Label | Setup |
|---|---|
| `noise-a`, `noise-b` | The same setup measured twice — shows how much results differ by chance. |
| `stock` | Unmodified Spotify, no ad blocker. **The baseline.** |
| `spotx` | SpotX-Bash only. |
| `spotx-spicetify` | Variant A: SpotX-Bash + Spicetify. |
| `spicetify-adblockify` | Variant B: Spicetify + adblockify. |

## Acceptance margins vs `stock`

RAM ≤ +10 %, idle CPU ≤ +0.5 percentage points of one core, startup ≤ +15 %.
If the difference between `noise-a` and `noise-b` is bigger than a margin, that margin becomes 2 × the noise.
