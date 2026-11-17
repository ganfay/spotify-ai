# API probe — internal client calls on the real client

Date: 2026-11-17. Spotify 1.3.4.258 (Linux, apt), Spicetify 2.46.7, free account.
Tool: `node scripts/dev/cdp-eval.mjs scripts/dev/api-probe.js` (read-only; reports shapes and counts, no names).

| Need | Call | Result | Notes |
|---|---|---|---|
| Playlists and folders | `Platform.RootlistAPI.getContents()` | **works**, 3 ms | Items: `uri, name, description, owner, totalLength, addedAt, images`. Folders have `items`. |
| Tracks of a playlist | `Platform.PlaylistAPI.getContents(uri, {limit})` | **works**, 0.6 s for 1,228 tracks | Returns everything in one call. Item: `uid, uri, name, artists[], album, duration, addedAt, addedBy, isExplicit, isPlayable, isLocal`. |
| Playlist details | `Platform.PlaylistAPI.getMetadata(uri)` | **works** | |
| Liked Songs | `Platform.LibraryAPI.getTracks({limit})` | **works**, 0.3 s for 963 tracks | |
| ISRC, popularity | `spclient…/metadata/4/track/{hex}` via `CosmosAsync` | **works**, ~0.9 s per track | Also returns **`language_of_performance`**, `has_lyrics`, `original_title` — useful for the language filter. `Spicetify.URI.idToHex` exists. |
| Energy, valence, tempo | `spclient…/audio-attributes/v1/audio-features/{id}` | **works**, ~0.6 s | Full set: danceability, energy, valence, tempo, acousticness, instrumentalness, speechiness, liveness, loudness, key, mode. |
| Lyrics of any track | `spclient…/color-lyrics/v2/track/{id}` | **works** on a free account, ~0.6 s | Returns lines and a **`language`** code. Monthly cap for free accounts not tested. |
| "Recommended songs" for a playlist | `Platform.PlaylistAPI.getRecommendedTracks(uri, 0, 20)` | **works** | Returned 10 items with `popularity` and `score`. |
| Radio for a track | `spclient…/inspiredby-mix/v2/seed_to_playlist/{trackUri}` | **works** | Returns a playlist URI to read with `getContents`. |
| Search | `GraphQL.Request(Definitions.searchModalResults, {searchTerm, offset, limit, numberOfTopResults, …})` | **works** | `searchTracks` / `searchDesktop` do **not** exist in this client. Result is `searchV2.topResultsV2.itemsV2` (mixed types → filter tracks). `searchSuggestions` also works. |
| Public Web API | `https://api.spotify.com/v1/me` with the client token | **429**, as expected | Confirms decision 16. |

## Write calls — tested on a throw-away playlist

Tool: `scripts/dev/api-probe-write.js` (creates one playlist named "spotify-ai test (safe to delete)", deletes it at the end; nothing was left behind).

| Action | Call | Result |
|---|---|---|
| Create playlist | `RootlistAPI.createPlaylist(name, {before: "start"})` | **works**, returns the playlist URI as a string |
| Add tracks | `PlaylistAPI.add(uri, [trackUris], {after: "end"})` | **works**, order kept; duplicates allowed; every entry gets a unique `uid` |
| Remove one of two identical tracks | `PlaylistAPI.remove(uri, [{uri, uid}])` | **works**: only the entry with that `uid` is removed, the other copy stays |
| Move to start | `PlaylistAPI.move(uri, [{uri, uid}], {before: "start"})` | **works**; `uid` and **`addedAt` are kept** |
| Move after another entry | `PlaylistAPI.move(uri, [{uri, uid}], {after: {uri, uid}})` | **works** |
| Rename / description | `PlaylistAPI.setAttributes(uri, {name, description})` | **works** |
| Delete playlist | `RootlistAPI.remove([{uri}])` | **works**; `RootlistAPI.contains` confirms it is gone |

Consequences for the agent: precise dedupe is possible (remove exactly the chosen copy), reordering does not destroy "date added", and undo can restore a playlist from a saved list of `{uri, uid, position}`.

## Behaviours found while building undo

- A read right after a write already returns the new state — no waiting needed.
- `PlaylistAPI.move` with several entries keeps their **relative playlist order**, not the order of the array. Moving all entries at once is a no-op. To reorder, move entries one at a time (undo moves only the entries that are out of place).
- `PlaylistAPI.add(uri, [tracks], {before: {uri, uid}})` inserts at an exact place and keeps the array order.

## UI surfaces

`Topbar.Button`, `Playbar.Button`, `PopupModal.display`, `ContextMenu.Item`, `Platform.History.push`, `Spicetify.React` — all present. `Spicetify.Panel` is **missing** on this version → no right side panel through that API; use a custom app page or a modal.

## Interesting extras found

`Platform.PromptedPlaylistsAPI`, `AssistedCurationAPI`, `PlaylistMixingAPI`, `RecentlyPlayedAPI`, `PlayHistoryAPI`, `YourLibraryTagsAPI` exist — worth a look later.

## Still to test

- Whether re-adding a removed track (for undo) can restore its original `addedAt` (probably not — to check).
- Throttling when calling `metadata/4`, `audio-features` and lyrics for ~1,000 tracks (per-track cost is 0.6–0.9 s → needs batching, a cache and a progress bar).
- Lyrics cap on a free account.
