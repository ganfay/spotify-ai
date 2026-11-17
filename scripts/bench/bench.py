#!/usr/bin/env python3
"""Measure RAM, CPU and startup time of the Spotify desktop client on Linux.

Standard library only. Needs Linux with cgroup v2 (any modern distro).

    bench.py startup --label stock            # restarts Spotify several times
    bench.py steady  --label stock            # measures the running Spotify
    bench.py report  --baseline stock         # compares all labels with "stock"

Results are appended to docs/perf/results.jsonl. See docs/perf/README.md.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RESULTS = REPO / "docs" / "perf" / "results.jsonl"
CLK_TCK = os.sysconf("SC_CLK_TCK")
MPRIS_NAME = "org.mpris.MediaPlayer2.spotify"
CPU_WINDOW = 0.25  # seconds; resolution of the "settled" startup time

# Acceptance margins against the baseline (docs/DECISIONS.md, decision 21).
MARGIN_RAM_PCT = 10.0
MARGIN_CPU_PP = 0.5
MARGIN_STARTUP_PCT = 15.0


# ---------------------------------------------------------------- processes

def spotify_pids() -> list[int]:
    """All running processes whose executable file is named 'spotify'."""
    pids = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            exe = os.readlink(f"/proc/{name}/exe")
        except OSError:
            continue
        if os.path.basename(exe.removesuffix(" (deleted)")) == "spotify":
            pids.append(int(name))
    return sorted(pids)


def stat_fields(pid: int) -> list[str]:
    """Fields of /proc/<pid>/stat after the process name (index 0 = state)."""
    data = Path(f"/proc/{pid}/stat").read_text()
    return data[data.rindex(")") + 2:].split()


def main_pid(pids: list[int]) -> int:
    """The Spotify process whose parent is not another Spotify process."""
    members = set(pids)
    for pid in pids:
        try:
            if int(stat_fields(pid)[1]) not in members:
                return pid
        except (OSError, ValueError, IndexError):
            continue
    return pids[0]


def pss_kb(pids: list[int]) -> int:
    """RAM of all processes in kB. PSS counts shared memory only once."""
    total = 0
    for pid in pids:
        try:
            with open(f"/proc/{pid}/smaps_rollup") as fh:
                for line in fh:
                    if line.startswith("Pss:"):
                        total += int(line.split()[1])
                        break
        except OSError:
            pass
    return total


def dedicated_cgroups(pids: list[int]) -> set[Path] | None:
    """The cgroups Spotify lives in, if (almost) nothing else lives in them.

    The desktop may move the main process into its own scope, so there can be
    more than one. Returns None when a cgroup is shared with other programs.
    """
    paths: set[Path] = set()
    for pid in pids:
        try:
            rel = Path(f"/proc/{pid}/cgroup").read_text().strip().split("::", 1)[1]
        except (OSError, IndexError):
            continue
        if not rel.endswith(".scope"):
            return None
        paths.add(Path("/sys/fs/cgroup") / rel.lstrip("/"))
    for path in paths:
        try:
            members = {int(p) for p in (path / "cgroup.procs").read_text().split()}
        except (OSError, ValueError):
            return None
        # One foreign process is tolerated (a launcher wrapper that just waits).
        if os.getpid() in members or len(members - set(pids)) > 1:
            return None
    return paths or None


class CpuMeter:
    """Cumulative CPU seconds used by Spotify since the first read()."""

    def __init__(self, fresh: bool = False) -> None:
        self.fresh = fresh  # True when we launched the app ourselves
        self.method: str | None = None
        self._usage: dict[Path, float] = {}
        self._base: float | None = None
        self._ticks: dict[int, int] = {}
        self._acc = 0
        self._primed = False
        self._last = 0.0

    def read(self, pids: list[int]) -> float:
        if not pids:
            return self._last
        if self.method is None:
            self.method = "cgroup" if dedicated_cgroups(pids) else "proc"
        value = self._read_cgroup(pids) if self.method == "cgroup" else self._read_proc(pids)
        self._last = max(self._last, value)
        return self._last

    def _read_cgroup(self, pids: list[int]) -> float:
        # Sum over every cgroup Spotify has been seen in; a cgroup that has
        # disappeared keeps its last known value.
        for path in (dedicated_cgroups(pids) or set()) | set(self._usage):
            try:
                for line in (path / "cpu.stat").read_text().splitlines():
                    if line.startswith("usage_usec"):
                        self._usage[path] = int(line.split()[1]) / 1e6
            except OSError:
                pass
        total = sum(self._usage.values())
        if self._base is None:
            # A fresh launch counts from zero; an already running app from now.
            self._base = 0.0 if self.fresh else total
        return total - self._base

    def _read_proc(self, pids: list[int]) -> float:
        for pid in pids:
            try:
                fields = stat_fields(pid)
                ticks = int(fields[11]) + int(fields[12])  # utime + stime
            except (OSError, ValueError, IndexError):
                continue
            if pid in self._ticks:
                self._acc += ticks - self._ticks[pid]
            elif self._primed:
                self._acc += ticks  # process was born during the measurement
            self._ticks[pid] = ticks
        self._primed = True
        return self._acc / CLK_TCK


# ------------------------------------------------------------ desktop state

def _run(argv: list[str], timeout: float = 3.0) -> str | None:
    try:
        res = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.stdout if res.returncode == 0 else None


def mpris_ready() -> bool:
    """True when Spotify has registered its media-player interface (UI is up)."""
    out = _run(["busctl", "--user", "call", "org.freedesktop.DBus", "/org/freedesktop/DBus",
                "org.freedesktop.DBus", "NameHasOwner", "s", MPRIS_NAME])
    return bool(out) and "true" in out


def playback() -> tuple[str | None, bool]:
    """(status, is_ad). Status is 'Playing', 'Paused', 'Stopped' or None."""
    base = ["busctl", "--user", "get-property", MPRIS_NAME, "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player"]
    status = _run(base + ["PlaybackStatus"])
    match = re.search(r'"(\w+)"', status or "")
    meta = _run(base + ["Metadata"]) or ""
    track = re.search(r'mpris:trackid" \w "([^"]*)', meta)
    is_ad = bool(track and re.search(r"[:/]ad[:/]", track.group(1)))
    return (match.group(1) if match else None), is_ad


def x_window_present(seen: set[str]) -> bool | None:
    """True when an X11 window of Spotify exists. None if we cannot look."""
    if not shutil.which("xprop") or not os.environ.get("DISPLAY"):
        return None
    root = _run(["xprop", "-root", "_NET_CLIENT_LIST"], timeout=2.0)
    if root is None:
        return None
    for wid in re.findall(r"0x[0-9a-f]+", root):
        if wid in seen:
            continue
        cls = _run(["xprop", "-id", wid, "WM_CLASS"], timeout=2.0) or ""
        if "spotify" in cls.lower():
            return True
        seen.add(wid)
    return False


def describe(pids: list[int]) -> dict:
    """Facts about the running client that make a result reproducible."""
    version, preload = None, None
    if not pids:
        return {"spotify_version": None, "ld_preload": None, "processes": 0}
    for pid in pids:
        try:
            cmd = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode(errors="ignore")
        except OSError:
            continue
        match = re.search(r"Spotify/(\d[\d.]*)", cmd)
        if match:
            version = match.group(1)
            break
    try:
        env = Path(f"/proc/{main_pid(pids)}/environ").read_bytes().split(b"\0")
        for item in env:
            if item.startswith(b"LD_PRELOAD="):
                preload = os.path.basename(item.split(b"=", 1)[1].decode(errors="ignore"))
    except OSError:
        pass
    return {"spotify_version": version, "ld_preload": preload, "processes": len(pids)}


# ----------------------------------------------------------------- startup

def stop_spotify(timeout: float = 20.0) -> None:
    pids = spotify_pids()
    if not pids:
        return
    # Spotify ignores SIGTERM for a long time; its own "Quit" command works at once.
    quit_ok = _run(["busctl", "--user", "call", MPRIS_NAME, "/org/mpris/MediaPlayer2",
                    "org.mpris.MediaPlayer2", "Quit"])
    if quit_ok is None:
        try:
            os.kill(main_pid(pids), signal.SIGTERM)
        except OSError:
            pass
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not spotify_pids():
            return
        time.sleep(0.2)
    sys.exit("error: Spotify did not exit after a polite request. Close it by hand and run again.")


def launch(cmd: str, index: int) -> None:
    argv = shlex.split(cmd)
    if shutil.which("systemd-run"):
        # Own cgroup scope => the kernel accounts CPU for exactly this app.
        argv = ["systemd-run", "--user", "--scope", "--quiet", "--collect",
                f"--unit=spotify-bench-{os.getpid()}-{index}", "--", *argv]
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)


def startup_once(args: argparse.Namespace, index: int) -> dict:
    stop_spotify()
    time.sleep(args.pause)
    meter, seen = CpuMeter(fresh=True), set()
    events: dict[str, float | None] = {"process": None, "window": None, "mpris": None, "settled": None}
    quiet, quiet_start, next_slow = 0, 0.0, 0.0
    pids: list[int] = []
    t0 = time.monotonic()
    launch(args.cmd, index)
    last_t, last_cpu = t0, 0.0
    while True:
        now = time.monotonic()
        t = now - t0
        if t > args.timeout:
            break
        pids = spotify_pids()
        if pids and events["process"] is None:
            events["process"] = t
        if pids and t >= next_slow:
            next_slow = t + 0.1
            if events["window"] is None and x_window_present(seen):
                events["window"] = time.monotonic() - t0
            if events["mpris"] is None and mpris_ready():
                events["mpris"] = time.monotonic() - t0
        now = time.monotonic()
        if now - last_t >= CPU_WINDOW:
            cpu = meter.read(pids)
            pct = (cpu - last_cpu) / (now - last_t) * 100
            window_start = last_t - t0
            last_t, last_cpu = now, cpu
            ui_up = events["window"] is not None or events["mpris"] is not None or (now - t0) > 15
            if pids and ui_up and pct < args.quiet_pct:
                if quiet == 0:
                    quiet_start = window_start
                quiet += 1
            else:
                quiet = 0
            if quiet * CPU_WINDOW >= args.quiet_seconds:
                events["settled"] = quiet_start
                break
        time.sleep(0.02)
    if events["process"] is None:
        sys.exit(f"error: no Spotify process appeared after running: {args.cmd}")
    return {
        **{f"t_{k}": (round(v, 2) if v is not None else None) for k, v in events.items()},
        "cpu_s": round(meter.read(pids), 2),
        "pss_mb": round(pss_kb(pids) / 1024, 1),
        "cpu_method": meter.method,
    }


def cmd_startup(args: argparse.Namespace) -> None:
    print(f"Startup test '{args.label}': {args.runs} measured runs + 1 warm-up. Spotify will restart.")
    runs = []
    for i in range(args.runs + 1):
        res = startup_once(args, i)
        tag = "warm-up (ignored)" if i == 0 else f"run {i}"
        print(f"  {tag:18} window {fmt(res['t_window'])} s | ready {fmt(res['t_mpris'])} s | "
              f"settled {fmt(res['t_settled'])} s | cpu {res['cpu_s']} s | ram {res['pss_mb']} MB")
        if i > 0:
            runs.append(res)
    record = {"kind": "startup", "label": args.label, "cmd": args.cmd, "runs": runs,
              **describe(spotify_pids())}
    save(record)
    for key in ("t_window", "t_mpris", "t_settled"):
        print(f"  median {key[2:]:8} {fmt(median([r[key] for r in runs]))} s")
    print("Spotify is left running.")


# ------------------------------------------------------------------ steady

def cmd_steady(args: argparse.Namespace) -> None:
    pids = spotify_pids()
    if not pids:
        sys.exit("error: Spotify is not running. Start it first (or use the 'startup' command).")
    meter = CpuMeter()
    status0, _ = playback()
    state = args.state or (status0 or "unknown").lower()
    print(f"Steady test '{args.label}' ({state}): {args.runs} windows of {args.seconds} s. "
          "Do not touch Spotify meanwhile.")
    runs, tainted = [], False
    for i in range(args.runs):
        c0, t0 = meter.read(pids), time.monotonic()
        samples = []
        while time.monotonic() - t0 < args.seconds:
            time.sleep(args.interval)
            pids = spotify_pids()
            if not pids:
                sys.exit("error: Spotify exited during the measurement.")
            samples.append(pss_kb(pids))
            status, is_ad = playback()
            # A failed read (None) is not a state change.
            if status is not None and status0 is not None and status != status0:
                tainted = True
                print(f"  ! playback changed: {status0} -> {status}")
            if is_ad:
                tainted = True
                print("  ! an ad is playing")
        elapsed = time.monotonic() - t0
        run = {"cpu_pct": round((meter.read(pids) - c0) / elapsed * 100, 2),
               "pss_mb": round(statistics.median(samples) / 1024, 1)}
        runs.append(run)
        print(f"  window {i + 1}: cpu {run['cpu_pct']} % of one core | ram {run['pss_mb']} MB")
    record = {"kind": "steady", "label": args.label, "state": state, "seconds": args.seconds,
              "runs": runs, "tainted": tainted, "cpu_method": meter.method, **describe(pids)}
    save(record)
    print(f"  median: cpu {median([r['cpu_pct'] for r in runs])} % | "
          f"ram {median([r['pss_mb'] for r in runs])} MB")
    if tainted:
        print("  WARNING: playback state changed or an ad played during the test -> marked 'tainted'.")


# ------------------------------------------------------------------ report

def cmd_report(args: argparse.Namespace) -> None:
    if not RESULTS.exists():
        sys.exit(f"error: no results yet ({RESULTS}).")
    rows: dict[str, dict[str, list[float]]] = {}
    for line in RESULTS.read_text().splitlines():
        rec = json.loads(line)
        if rec.get("tainted") and not args.include_tainted:
            continue
        row = rows.setdefault(rec["label"], {})
        for run in rec["runs"]:
            if rec["kind"] == "startup":
                if run.get("t_settled") is not None:
                    row.setdefault("startup_s", []).append(run["t_settled"])
            else:
                row.setdefault(f"cpu_{rec['state']}", []).append(run["cpu_pct"])
                row.setdefault(f"ram_{rec['state']}", []).append(run["pss_mb"])
    metrics = sorted({m for row in rows.values() for m in row})
    summary = {label: {m: median(v) for m, v in row.items()} for label, row in rows.items()}
    base = summary.get(args.baseline) if args.baseline else None
    for label, row in summary.items():
        print(f"\n{label}")
        for metric in metrics:
            if metric not in row:
                continue
            value, note = row[metric], ""
            if base and label != args.baseline and metric in base and base[metric]:
                note = "   " + verdict(metric, value, base[metric])
            unit = "s" if metric == "startup_s" else ("% core" if metric.startswith("cpu") else "MB")
            print(f"  {metric:14} {value:>8} {unit}{note}")


def verdict(metric: str, value: float, base: float) -> str:
    if metric.startswith("cpu"):
        diff = value - base
        ok = diff <= MARGIN_CPU_PP
        return f"{diff:+.2f} pp  {'PASS' if ok else 'FAIL'} (limit +{MARGIN_CPU_PP} pp)"
    diff = (value - base) / base * 100
    limit = MARGIN_STARTUP_PCT if metric == "startup_s" else MARGIN_RAM_PCT
    return f"{diff:+.1f} %  {'PASS' if diff <= limit else 'FAIL'} (limit +{limit:.0f} %)"


# ----------------------------------------------------------------- helpers

def median(values: list) -> float | None:
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 2) if values else None


def fmt(value: float | None) -> str:
    return "  n/a" if value is None else f"{value:5.2f}"


def save(record: dict) -> None:
    record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), **record}
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    with RESULTS.open("a") as fh:
        fh.write(json.dumps(record) + "\n")
    print(f"  saved to {RESULTS.relative_to(REPO)}")


def label(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", value):
        raise argparse.ArgumentTypeError("use lowercase letters, digits and '-'")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("startup", help="restart Spotify several times and time it")
    p.add_argument("--label", type=label, required=True, help="name of the setup, e.g. stock, spotx")
    p.add_argument("--runs", type=int, default=5)
    p.add_argument("--cmd", default="spotify", help="command that starts Spotify")
    p.add_argument("--timeout", type=float, default=90.0)
    p.add_argument("--pause", type=float, default=3.0, help="seconds to wait between runs")
    p.add_argument("--quiet-pct", type=float, default=10.0, help="'settled' = CPU below this %% of one core...")
    p.add_argument("--quiet-seconds", type=int, default=3, help="...for this many seconds in a row")
    p.set_defaults(func=cmd_startup)

    p = sub.add_parser("steady", help="measure RAM and CPU of the running Spotify")
    p.add_argument("--label", type=label, required=True)
    p.add_argument("--state", choices=["paused", "playing"], help="default: read from Spotify")
    p.add_argument("--runs", type=int, default=5)
    p.add_argument("--seconds", type=float, default=60.0)
    p.add_argument("--interval", type=float, default=5.0)
    p.set_defaults(func=cmd_steady)

    p = sub.add_parser("report", help="show medians per label and compare with a baseline")
    p.add_argument("--baseline", type=label)
    p.add_argument("--include-tainted", action="store_true")
    p.set_defaults(func=cmd_report)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
