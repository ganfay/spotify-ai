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
3. **AI Playlists** from this repository — a Spicetify custom app: duplicate finder and an AI agent that filters by language, splits by mood, cleans up and recommends. It only proposes; nothing changes until you press a button.

Spicetify and adblockify are **not** part of this repository. The installer downloads pinned versions from their official repositories and verifies checksums.

## Install (Linux, Spotify from the official apt repository)

Open Spotify once and log in, then:

```bash
git clone https://github.com/ganfay/spotify-ai.git && cd spotify-ai && ./install.sh
```

Something broke? Run `./install.sh` again — it repairs the setup.
Remove everything: `./install.sh --uninstall`.

The installer asks for `sudo` twice on the first run: to stop Spotify auto-updates (`apt-mark hold`) and to let your user write to `/usr/share/spotify`. Windows and macOS are not supported yet.

Side effect to know about: the ad blocker switches the client to a "premium" state (for example unlimited skips). Server-side premium features (downloads, higher quality) stay locked.

## Docs

- [docs/IDEA.md](docs/IDEA.md) — what we build and why
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisions and their reasons
- [docs/STATUS.md](docs/STATUS.md) — done / next / blockers
- [docs/RESEARCH.md](docs/RESEARCH.md) — Phase 0 research report
- [docs/PLAN.md](docs/PLAN.md) — phases, acceptance criteria, risks

## Disclaimer

This is an unofficial hobby project. It is not affiliated with Spotify. Modifying the Spotify client may break Spotify's Terms of Use — use it at your own risk.
