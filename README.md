# spotify-ai

> Works on Windows, macOS and Linux. Tested by people on all three; a daily automatic check installs it on real Windows and macOS machines and opens an issue when a new Spotify breaks something.

A desktop Spotify setup for Windows, macOS and Linux:

- no ads;
- listening stats keep working (Recently played, Listening stats, Wrapped);
- an AI agent inside Spotify that manages your playlists in plain language;
- you never enter API keys and never give your credentials to anyone.

It is built from three parts, installed by one command:

1. [Spicetify](https://github.com/spicetify/cli) — mod platform for the Spotify desktop client;
2. [adblockify](https://github.com/rxri/spicetify-extensions) by rxri — ad-blocking Spicetify extension;
3. **AI Playlists** from this repository — a Spicetify custom app: duplicate finder and an AI agent that filters by language, splits by mood, cleans up and recommends. It only proposes; nothing changes until you press a button. Interface in English, Ukrainian, Russian and German.

Spicetify and adblockify are **not** part of this repository. The installer downloads pinned versions from their official repositories and verifies their checksums. One thing is not pinned: when Spicetify patches Spotify it downloads its own current "CSS map" from the Spicetify repository on GitHub.

## Install

Your account, playlists and likes are never touched by the installer. Something broke later? Run the installer again — it repairs the setup.

### Windows 10 / 11

Press <kbd>Win</kbd>+<kbd>R</kbd>, paste this, press Enter:

```
powershell -NoExit -c "irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 | iex"
```

That is all: no administrator rights, no git. If Spotify is not installed, the installer gets it from Spotify's own server. Spotify from the Microsoft Store cannot be modified — the installer offers to replace it with the normal one.

Remove everything — the same way with this command:

```
powershell -NoExit -c "$env:SPOTIFY_AI_UNINSTALL='1'; irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 | iex"
```

**Prefer a double-click?** Download [install.cmd](https://github.com/ganfay/spotify-ai/releases/latest/download/install.cmd) (and [uninstall.cmd](https://github.com/ganfay/spotify-ai/releases/latest/download/uninstall.cmd) to remove) and run it. This works only when Windows lets you run downloaded scripts:

- "Windows protected your PC" (SmartScreen): press **More info → Run anyway**.
- "Smart App Control blocked a file that may be unsafe" (Windows 11): there is no "run anyway" for it. Use the pasted command above instead. **Do not switch Smart App Control off just for this** — Windows cannot switch it back on without a reset.

### macOS (Ventura or newer, Apple Silicon and Intel)

Open the **Terminal** app, paste this, press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh | bash
```

If Spotify is not installed, the installer gets it from Spotify's own server. The first time, macOS may refuse to let Terminal change apps. The installer then tells you what to do: System Settings → Privacy & Security → **App Management** → switch on Terminal, reopen Terminal, run the same command again.

Remove everything:

```bash
curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh | bash -s -- --uninstall
```

### Linux (x86_64, Spotify from the official apt repository)

Open Spotify once and log in, then:

```bash
git clone https://github.com/ganfay/spotify-ai.git && cd spotify-ai && ./install.sh
```

Remove everything: `./install.sh --uninstall`. The installer asks for `sudo` twice on the first run: to stop Spotify auto-updates (`apt-mark hold`) and to let your user write to `/usr/share/spotify`.

### Already have a modified Spotify?

On Windows and macOS the installer looks at the Spotify that is already there. If it was changed by another mod (SpotX, BlockTheSpot, a "cracked" copy …), it says what it found and offers to put a clean copy from Spotify's own server in its place. You stay logged in; playlists and likes live on Spotify's servers. If you keep the modified one, ad blocking or the AI Playlists button may not work, Spotify may open as an empty window, and uninstalling returns Spotify to that modified state. A Spotify that already has Spicetify is not replaced: your Spicetify is kept and only our parts are added (your theme is switched off).

### Options

**Most people need none of these.** Ad blocking can be switched on and off inside the app (AI Playlists → Settings), without the installer.

An option is a small addition to the install command. Copy the whole line for your system; your choice is remembered for later runs.

**Install without the ad blocker**

| System | Command |
|---|---|
| Windows (<kbd>Win</kbd>+<kbd>R</kbd>) | `powershell -NoExit -c "$env:SPOTIFY_AI_ADBLOCK='off'; irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 \| iex"` |
| macOS (Terminal) | `curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh \| bash -s -- --adblock off` |
| Linux | `./install.sh --adblock off` |

To bring it back, run the same line with `on` instead of `off`.

**Let Spotify send crash reports and interface logs to its developers again** (they are stopped by default; listening statistics are never blocked)

| System | Command |
|---|---|
| Windows | `powershell -NoExit -c "$env:SPOTIFY_AI_BLOCK_REPORTS='off'; irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 \| iex"` |
| macOS | `curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh \| bash -s -- --block-reports off` |
| Linux | `./install.sh --block-reports off` |

**Do not ask when Spotify is newer than the tested version**

| System | Command |
|---|---|
| Windows | `powershell -NoExit -c "$env:SPOTIFY_AI_FORCE='1'; irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 \| iex"` |
| macOS | `curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh \| bash -s -- --force` |

**Replace a modified Spotify with a clean one without being asked** (`no` keeps it)

| System | Command |
|---|---|
| Windows | `powershell -NoExit -c "$env:SPOTIFY_AI_CLEAN='yes'; irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 \| iex"` |
| macOS | `curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh \| bash -s -- --clean-spotify yes` |

How it works, if you want to combine options: on macOS and Linux they go at the end of the command, after `bash -s --` (for example `… | bash -s -- --adblock off --force`). On Windows each one is a `$env:NAME='value';` in front of `irm`. With a downloaded copy of the repository on Windows: `.\install.cmd -Adblock off`.

What data goes where: [docs/PRIVACY.md](docs/PRIVACY.md).

Side effect to know about: the ad blocker switches the client to a "premium" state (for example unlimited skips). Server-side premium features (downloads, higher quality) stay locked.

### "Spotify is newer than the tested version"

On Windows and macOS Spotify can only be downloaded in its current version, and Spotify publishes a new one almost every week. When yours is newer than the last one tested here, the installer says so and asks **Try anyway?** — it usually works. If Spotify then looks broken, uninstalling brings it back, and you can try again a few days later.

The installer's questions and errors are shown in English, Ukrainian, Russian or German, following the language of your system.

## What installing changes on your computer

Read this before you install:

- **Spotify stops updating.** You keep the tested version, but you also stop getting Spotify's security fixes for its built-in browser engine until you update on purpose. Linux: `apt-mark hold`. Windows: a locked file named `Update` in `%LOCALAPPDATA%\Spotify`. macOS: the folder `~/Library/Application Support/Spotify/PersistentCache/Update` is locked.
- **Linux: your user becomes the owner of `/usr/share/spotify`** (normally owned by root). Spicetify needs this to patch the client. The price: any program running as your user can now change Spotify's files without asking for a password. (On Windows and macOS your user can change them already.)
- **Windows and macOS: Spicetify is installed** into `%LOCALAPPDATA%\spicetify` and `%APPDATA%\spicetify`, or `~/.spicetify` and `~/.config/spicetify`.
- **macOS: the "downloaded from the internet" mark is removed from Spotify.** A patched Spotify no longer matches its signature, and with that mark macOS would call it "damaged" and refuse to open it. The copy the installer downloads itself is checked against Spotify's signature before anything is changed.
- Uninstalling undoes all of this.
- Modifying the Spotify client and blocking ads is against Spotify's terms of use. No account bans are known for this setup, but nobody can promise there will never be one. You use it at your own risk.

## Docs

- [docs/IDEA.md](docs/IDEA.md) — what we build and why
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisions and their reasons
- [docs/STATUS.md](docs/STATUS.md) — done / next / blockers
- [docs/RESEARCH.md](docs/RESEARCH.md) — Phase 0 research report
- [docs/PLAN.md](docs/PLAN.md) — phases, acceptance criteria, risks

## Disclaimer

This is an unofficial hobby project. It is not affiliated with Spotify. Modifying the Spotify client may break Spotify's Terms of Use — use it at your own risk.
