# spotify-ai (working title)

> **Status: early. Linux only for now. Ad blocking and the AI Playlists app install with one command.**

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

## Install (Linux, Spotify from the official apt repository)

Open Spotify once and log in, then:

```bash
git clone https://github.com/ganfay/spotify-ai.git && cd spotify-ai && ./install.sh
```

Something broke? Run `./install.sh` again — it repairs the setup.
Remove everything: `./install.sh --uninstall`.

Ad blocking can be switched in AI Playlists → Settings. Installer options (remembered for later runs): `./install.sh --adblock off` does not install the blocker at all; `./install.sh --block-reports off` lets Spotify send crash reports and interface logs to its developers again. Listening statistics are never blocked. What data goes where: [docs/PRIVACY.md](docs/PRIVACY.md).

The installer asks for `sudo` twice on the first run: to stop Spotify auto-updates (`apt-mark hold`) and to let your user write to `/usr/share/spotify`. Windows and macOS are not supported yet.

Side effect to know about: the ad blocker switches the client to a "premium" state (for example unlimited skips). Server-side premium features (downloads, higher quality) stay locked.

## What installing changes on your computer (Linux)

Read this before you install:

- **Spotify stops updating** (`apt-mark hold`). You keep the tested version, but you also stop getting Spotify's security fixes for its built-in browser engine until you update on purpose.
- **Your user becomes the owner of `/usr/share/spotify`** (normally owned by root). Spicetify needs this to patch the client. The price: any program running as your user can now change Spotify's files without asking for a password.
- `./install.sh --uninstall` undoes both.
- Modifying the Spotify client and blocking ads is against Spotify's terms of use. No account bans are known for this setup, but nobody can promise there will never be one. You use it at your own risk.

## Docs

- [docs/IDEA.md](docs/IDEA.md) — what we build and why
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisions and their reasons
- [docs/STATUS.md](docs/STATUS.md) — done / next / blockers
- [docs/RESEARCH.md](docs/RESEARCH.md) — Phase 0 research report
- [docs/PLAN.md](docs/PLAN.md) — phases, acceptance criteria, risks

## Disclaimer

This is an unofficial hobby project. It is not affiliated with Spotify. Modifying the Spotify client may break Spotify's Terms of Use — use it at your own risk.
