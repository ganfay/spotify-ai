# spotify-ai (working title)

> **Status: research / planning. Nothing is installable yet.**

A desktop Spotify setup for Windows, macOS and Linux:

- no ads;
- listening stats keep working (Recently played, Listening stats, Wrapped);
- an AI agent inside Spotify that manages your playlists in plain language;
- you never enter API keys and never give your credentials to anyone.

It is built from three layers, installed by one command:

1. [SpotX](https://github.com/SpotX-Official/SpotX) (Windows) / [SpotX-Bash](https://github.com/SpotX-Official/SpotX-Bash) (macOS, Linux) — ad blocking;
2. [Spicetify](https://github.com/spicetify/cli) — mod platform for the Spotify desktop client;
3. the agent from this repository — a Spicetify extension.

SpotX and Spicetify are **not** part of this repository. The installer downloads them from their official repositories.

## Docs

- [docs/IDEA.md](docs/IDEA.md) — what we build and why
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisions and their reasons
- [docs/STATUS.md](docs/STATUS.md) — done / next / blockers

## Disclaimer

This is an unofficial hobby project. It is not affiliated with Spotify. Modifying the Spotify client may break Spotify's Terms of Use — use it at your own risk.
