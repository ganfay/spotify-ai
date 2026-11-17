# Rollback (Linux, apt install)

How to return the dev machine to the state of 2026-11-17, before any patching.

## What was saved

Local folder `backups/2026-11-17-stock/` (git-ignored, never pushed):

| File | What |
|---|---|
| `Apps/` | Copy of `/usr/share/spotify/Apps` (stock `xpui.spa`, `login.spa`). |
| `usr-share-spotify.sha256` | Checksums of every file in `/usr/share/spotify` — proves whether the client is stock. |
| `permissions.txt` | Original owner and mode of the Spotify folder and files. |
| `package.txt`, `apt-holds.txt` | Installed package version and held packages. |
| `deb/spotify-client_…1.3.4.258…deb` | The official installer package, downloaded from Spotify's apt repository. |
| `spotify-adblock/` | Both `config.toml` files, the launcher, checksum of the library. |

## Check: is the client stock right now?

```bash
cd /usr/share/spotify && sha256sum --quiet -c ~/GolandProjects/spotify-ai/backups/2026-11-17-stock/usr-share-spotify.sha256 && echo STOCK
```

## Undo, from smallest to biggest step

1. **Remove Spicetify changes:** `spicetify restore`
2. **Remove SpotX-Bash patches:** `bash <(curl -sSL https://spotx-official.github.io/run.sh) --uninstall`
3. **Guaranteed reset of all client files** (works even if 1 and 2 fail):

   ```bash
   sudo apt install --reinstall ./backups/2026-11-17-stock/deb/spotify-client_*.deb
   ```

4. **Restore folder permissions** (if Spicetify's `chmod a+wr` was applied): step 3 already resets them; otherwise

   ```bash
   sudo chmod 755 /usr/share/spotify /usr/share/spotify/Apps && sudo chmod 644 /usr/share/spotify/Apps/*
   ```

5. **Allow updates again:** `sudo apt-mark unhold spotify-client`
6. **Remove Spicetify itself:** `rm -rf ~/.spicetify ~/.config/spicetify`

Run the stock check above afterwards.

## The previous ad blocker

`abba23/spotify-adblock` is **not touched** by any step: library `/usr/local/lib/spotify-adblock.so`, configs in `/etc/spotify-adblock/` and `~/.config/spotify-adblock/`, launcher `~/.local/share/applications/spotify-adblock.desktop` ("Spotify (adblock)"). After a reset to stock it works as before. Do not use that launcher while SpotX or adblockify is being tested — two blockers at once would spoil the test.

Spotify login, cache and settings (`~/.config/spotify`, `~/.cache/spotify`) are not changed by SpotX-Bash or Spicetify.
