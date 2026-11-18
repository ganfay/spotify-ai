# Privacy: what goes where

Written for users, not lawyers. Last checked: 2026-11-18.

## Your Spotify account

- You log in to the normal Spotify app. This project never sees your password and never asks for it.
- The AI Playlists app works with the session the Spotify app already has. It does not send your Spotify login or session to anyone.

## What Spotify still receives

- **Listening statistics** (what you played) — always sent, exactly as in unmodified Spotify. This is what "Recently played", listening stats and Wrapped are built from. Nothing here blocks it.
- **Ads** — with ad blocking on (the default), the ad system inside the client is switched off. You can switch it in AI Playlists → Settings.
- **Crash reports and interface logs to Spotify's developers** — stopped by default (a standard Spicetify option). `./install.sh --block-reports off` lets Spotify receive them again.

## What the AI receives

Only when you send a request to the AI agent:

- the text you typed;
- the playlists the agent needs to read for that request: track titles, artists, albums, dates added, and — for language or mood tasks — Spotify's language code and audio numbers for those tracks.

Never: your Spotify login, e-mail, payment data, or playlists the request does not touch.

Where it goes depends on the mode in Settings:

| Mode | Path | Who can see the request |
|---|---|---|
| **Shared free access** | your Spotify app → this project's server (Cloudflare Worker) → Google Gemini | Google. The server only passes the request on. |
| **My own API key** | your Spotify app → the provider you chose (Google, Anthropic, OpenAI, xAI, OpenRouter or your own address) | That provider. Your key is stored only on your computer. |

**Free AI tiers:** the shared access uses a free Gemini key. Under Google's terms for the free tier, requests may be used to improve Google's products and may be read by human reviewers. If that matters to you, use your own paid key.

## What this project's server stores

The server exists to keep the shared key out of the app and to stop one person from using up everyone's quota. It stores:

- a random install number your app generated (not your Spotify name);
- counters: how many requests that install made, and when;
- a scrambled (hashed) form of your internet address, kept for 2 days, to limit how many new installs one address can create.

It does **not** store or log your requests or the AI's answers.

## What stays on your computer

Settings (including an API key you entered), undo points for playlists you changed, and a cache of track facts. They live in the Spotify app's local storage and are not uploaded.

## Age

AI providers require users to be 18 or older.
