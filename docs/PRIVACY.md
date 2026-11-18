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
- **the names and sizes of your playlists** (so the agent can find the one you mean) — all of them when you use the free-form "AI agent" card, only the chosen one when you start from another card and pick a playlist;
- the contents of the playlists the agent reads for that request: track titles, artists, albums, dates added, and — for language or mood tasks — Spotify's language code and audio numbers for those tracks.

Never: your Spotify login or session, e-mail, payment data, the names of playlist owners, or the tracks of playlists the agent did not open for the request.

Be aware: names of playlists and tracks are text written by other people. The agent treats them as data, and it has no way to change your library on its own — every change needs your click — but a strangely named playlist can still confuse it into a wrong proposal. Look at a proposal before confirming it.

Where it goes depends on the mode in Settings:

| Mode | Path | Who can see the request |
|---|---|---|
| **Shared free access** | your Spotify app → this project's server (a Cloudflare Worker) → Google Gemini | Google, and Cloudflare as the company that runs the server. The server passes the request on and does not store it. |
| **My own API key** | your Spotify app → the provider you chose (Google, Anthropic, OpenAI, xAI, OpenRouter or your own address) | That provider. Your key is stored only on your computer. |

**Free AI tiers:** the shared access uses a free Gemini key. Under Google's terms for the free tier, requests may be used to improve Google's products and may be read by human reviewers. If that matters to you, use your own paid key.

## What this project's server stores

The server exists to keep the shared key out of the app and to stop one person from using up everyone's quota. It stores:

- a random install number your app generated (not your Spotify name), with the time it was first and last seen — kept for 90 days after its last use;
- counters: how many requests that install made, and when — kept for about 2–3 days;
- a keyed hash of your internet address (it cannot be turned back into the address without the server's secret), kept for about 2–3 days, to limit how much one address can use;
- if invite codes are switched on: which code an install used.

It does **not** store or log your requests or the AI's answers.

## What stays on your computer

Settings (including an API key you entered), undo points for playlists you changed, a cache of track facts, and your last 5 chats with the agent (what was on the screen: your messages, the answers and the proposals with their track lists; you can delete each chat in the list). They live in the Spotify app's local storage and are not uploaded.

**About your own API key:** it is stored unencrypted in the Spotify app's local storage. Other Spicetify extensions or themes you install, and any program running under your user account, could read it. It is sent only to the provider selected in Settings, and it is cleared when you switch to another provider. Uninstalling does not delete it — remove it in Settings first. Use a key you can revoke, and set a spending limit at the provider.

## Age

AI providers require users to be 18 or older.
