# spotify-ai-proxy

A small Cloudflare Worker that sits between the Spotify-client extension and
the Google Gemini API.

It does two jobs:

1. **Keeps the Gemini API key secret.** The key lives only on Cloudflare. The
   extension never sees it.
2. **Enforces limits**, so a few friends can share one key without anyone
   using it all up.

It runs on the Cloudflare **free** plan.

## What it stores (privacy)

The Worker stores only what it needs for counting:

- the install id (a random id the extension makes once per install);
- prompt ids with a timestamp and a request count (ids only, no text);
- daily counters (all requests; new installs per IP);
- a **hash** of the IP address, never the IP itself. The hash is mixed with a
  secret salt and is deleted after 2 days;
- invite codes (code, label, created time, revoked or not) and which code an
  install used.

It **never stores and never logs prompt text or model answers.** They only pass
through.

Prompt rows and daily counters are deleted after 2 days. An install id row is
deleted after 90 days without use.

## Deploy (one time)

You need Node.js and a free Cloudflare account. Run these inside `worker/`:

```sh
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_TOKEN
```

- `wrangler login` opens a browser window to connect your Cloudflare account.
- `wrangler deploy` prints the address of your Worker, like
  `https://spotify-ai-proxy.<your-name>.workers.dev`. Put this address into the
  extension.
- Each `secret put` asks you to paste a value. For `ADMIN_TOKEN` make up a long
  random string (for example run `openssl rand -hex 32`) and keep it private.
  Without `ADMIN_TOKEN` the admin routes are switched off.

Optional, makes the IP hashes unique to your deployment:

```sh
npx wrangler secret put IP_SALT
```

Set `IP_SALT` once and do not change it later (a change resets the "new
installs per IP" counting for the current day).

Until `GEMINI_API_KEY` is set, `/v1/generate` answers `503`.

## Change the limits

Open `wrangler.jsonc`, edit the values under `"vars"`, then run
`npx wrangler deploy` again. All values are strings.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PROMPTS_PER_HOUR` | `5` | New prompts one install may start in any 60 minutes |
| `REQUESTS_PER_PROMPT` | `40` | Requests allowed inside one prompt (the agent loop) |
| `NEW_INSTALLS_PER_IP_PER_DAY` | `5` | New install ids one IP may register per day (UTC) |
| `GLOBAL_REQUESTS_PER_DAY` | `400` | All requests from everybody per day (UTC) |
| `MODEL` | `gemini-3.5-flash-lite` | Gemini model. The client cannot choose it |
| `MAX_OUTPUT_TOKENS` | `16384` | Maximum answer size. The client cannot choose it |
| `ALLOWED_ORIGINS` | `https://xpui.app.spotify.com` | Web origins allowed to call the Worker, comma-separated |
| `REQUIRE_INVITE` | `false` | `true` = an invite code is needed |
| `KILL_SWITCH` | `false` | `true` = the Worker answers `503` to everyone |

## Invite mode

1. In `wrangler.jsonc` set `"REQUIRE_INVITE": "true"` and run
   `npx wrangler deploy`.
2. Create a code for each friend (the label is just a note for you):

```sh
export URL=https://spotify-ai-proxy.<your-name>.workers.dev
export ADMIN_TOKEN=<your admin token>

curl -X POST "$URL/admin/invites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"label":"Friend name"}'
```

The answer contains the `code`. Give it to your friend; they enter it in the
extension.

List all codes:

```sh
curl "$URL/admin/invites" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Revoke (switch off) a code:

```sh
curl -X DELETE "$URL/admin/invites/<code>" -H "Authorization: Bearer $ADMIN_TOKEN"
```

See today's usage (request count, number of installs, most active installs):

```sh
curl "$URL/admin/stats" -H "Authorization: Bearer $ADMIN_TOKEN"
```

The invite code is only the door key. Limits are still counted per install.

## Kill switch

If something goes wrong (for example someone abuses the key), stop everything:

1. In `wrangler.jsonc` set `"KILL_SWITCH": "true"`.
2. Run `npx wrangler deploy`.

Every `/v1/...` request now gets `503 disabled`, and Gemini is not called. Set
it back to `"false"` and deploy again to turn the service on.

## Run locally

```sh
cp .dev.vars.example .dev.vars   # then put your own values into .dev.vars
npm run dev
```

`.dev.vars` is git-ignored. Never commit it. The local Worker listens on
`http://localhost:8787`. Example:

```sh
curl http://localhost:8787/v1/status \
  -H "x-install-id: 3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b"
```

## Tests

```sh
npm test          # runs inside the real Workers runtime, Gemini is mocked
npm run typecheck
```

The tests never call Gemini or Cloudflare and need no API key.

## API (short)

- `POST /v1/generate` — headers `x-install-id` (UUID v4), `x-prompt-id` (UUID),
  `x-invite-code` (only in invite mode). JSON body:
  `{ systemInstruction?, contents, tools?, generationConfig?: { temperature?, responseMimeType?, responseSchema? } }`.
  Any other field is rejected. Answers with Gemini's JSON unchanged.
- `GET /v1/status` — header `x-install-id`. Shows how many prompts are left
  this hour. Does not use quota.
- Errors always look like
  `{ "error": "<code>", "message": "...", "scope"?: "...", "retryAfterSeconds"?: n }`.
  Codes: `bad_request` 400, `invite_required` 401, `forbidden` 403 (web origin
  not in `ALLOWED_ORIGINS`), `not_found` 404, `payload_too_large` 413,
  `rate_limited` 429 (scope `install`, `prompt`, `ip`, `global` or `provider`),
  `upstream` 502, `disabled` 503.
