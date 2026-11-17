# Idea

A cleaned-up version of the original project brief (2026-11-17).

## What we build

A desktop Spotify setup published on GitHub and shared with friends (**Windows, macOS, Linux**):

- no ads (including audio ads between tracks);
- listening stats keep working (in-app "Listening stats", "Recently played", Wrapped);
- an **AI agent inside Spotify** that manages the user's playlists with natural language;
- the user **never enters API keys and never gives credentials to anyone** — they just log in to the normal Spotify app.

iOS is out of scope (there is no legitimate way to modify the iOS app).

## Priorities (in this order)

1. **No ads** on all 3 OSes.
2. **Stats keep counting.**
3. **Performance:** while just listening (agent idle), CPU / RAM / startup time ≈ stock Spotify. The agent may use more resources only while it works on a request.
4. **AI agent** (first a primitive version, to test the core).
5. **Clean, non-intrusive UI** for the agent.
6. **Settings toggles:** ad blocking on/off; which stats/telemetry data is sent on/off.

## Architecture: three layers + one installer

| Layer | Role | Source |
|---|---|---|
| **SpotX** (Windows) / **SpotX-Bash** (macOS, Linux) | Ad blocking + blocking Spotify auto-updates | Downloaded by the installer from the official repos. Not copied into this repo. |
| **Spicetify** | Mod platform inside the Spotify desktop app | Downloaded by the installer from the official repo |
| **Agent** | Spicetify extension or custom app (TypeScript/React) | This repo |

- **Installer:** one command per OS. Order: SpotX → Spicetify → agent. Re-running it repairs everything.
- **Spotify API access:** only through the user's own session inside the client (Spicetify APIs). No Spotify developer app, no developer tokens.
- **Updates:** Spotify auto-updates are blocked. We move manually to a tested version and ship an updated installer.
- **Ads fallback:** a Spicetify-level ad blocker only if SpotX fails the tests.

## AI access: two modes

1. **Default — proxy:** the client calls a Cloudflare Worker; the Worker holds the Gemini API key and applies per-user rate limits. The user sees no key.
2. **Optional — own key:** the user enters their own Gemini key in settings → direct calls to Gemini.

The API key must never be in the repo or in the client code.

## Lesson already learned

The Linux ad blocker `abba23/spotify-adblock` blocks `https://spclient.wg.spotify.com/gabo-receiver-service/.*` in its default config. That endpoint carries **playback events**; blocking it killed listening stats. **Every ad blocker we use must be checked for this.**

## Agent features (core for Phase 2)

General rule: **the agent proposes, the user approves.** It shows what it found and why, and changes nothing until confirmed. By default it **creates a new playlist** and leaves the original untouched.

1. **Remove duplicates** — exact duplicates and the same song in different versions (remaster, live, single vs album). Show the list, the user chooses what to remove.
2. **Filter by language / content → new playlist.** Example: "take playlist X, exclude every track that has anything in Russian (title, artist, lyrics), put the rest into a new playlist". Ukrainian ≠ Russian: both use Cyrillic, so "has Cyrillic" is not enough. Unsure cases are marked for the user to decide.
3. **Split a huge playlist** into several smaller ones by mood (or genre / energy). Show the proposed groups first.
4. **Clean a playlist** — find tracks that don't fit, show them with a short reason each, the user ticks what to remove.
5. **Recommendations based on a playlist**, with a reason for each track.

Safety for all features: every destructive action shows a preview and needs confirmation; a snapshot is saved before changes so the user can undo.

## Phases

- **Phase 0** — research and plan (no code).
- **Phase 1** — ads + stats on Linux, performance baseline, installer v0.
- **Phase 2** — primitive agent + proxy.
- **Phase 3** — clean UI.
- **Phase 4** — settings toggles, own-key field.
- **Phase 5** — Windows and macOS installers, README, releases.

## Working rules

- The repo is public: no secrets, no personal data.
- No code is copied from repositories without a compatible license. Reference project [Tonphon/SmartSort](https://github.com/Tonphon/SmartSort) has no license → ideas only.
- System files are not changed without saying so first. Reversible steps, backups.
- Small commits with clear messages.
- Facts are verified against official docs, repos, licenses and changelogs.
