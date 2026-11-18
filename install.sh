#!/usr/bin/env bash
# spotify-ai installer v0 — Linux, Spotify from the official apt repository.
#
#   ./install.sh                     install or repair (safe to run again)
#   ./install.sh --adblock off       do not install the ad blocker at all (default: on;
#                                    when installed it can also be switched in the app's Settings)
#   ./install.sh --block-reports off let Spotify send crash reports and interface
#                                    logs to its developers (on = stop them, the default)
#   ./install.sh --uninstall         return Spotify to its original state
#
# Choices are remembered, so a later plain ./install.sh keeps them.
# Listening statistics (Recently played, Wrapped) are never blocked.
#
# What it does (variant B, docs/DECISIONS.md):
#   1. stops Spotify auto-updates (apt hold);
#   2. lets your user write to the Spotify folder (needed by Spicetify);
#   3. installs Spicetify at a pinned version into ~/.spicetify;
#   4. installs the adblockify extension at a pinned commit;
#   5. installs the AI Playlists app from this repository;
#   6. applies everything to Spotify.
# Everything is downloaded from the official repositories and checked by SHA-256.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions
source "${HERE}/versions"

SPOTIFY_DIR="/usr/share/spotify"
SPICETIFY_HOME="${HOME}/.spicetify"
SPICETIFY="${SPICETIFY_HOME}/spicetify"
SPICETIFY_CONFIG_DIR="${HOME}/.config/spicetify"
EXTENSION="spotify-ai-adblock.js"
OLD_EXTENSION="adblock.js"   # name used by earlier versions of this installer
AGENT_APP="ai-playlists"
AGENT_SOURCE="${HERE}/agent/release/${AGENT_APP}"
MPRIS="org.mpris.MediaPlayer2.spotify"
OPTIONS_FILE="${HOME}/.config/spotify-ai/options"

# Defaults; overwritten by the saved choices and then by command-line flags.
ADBLOCK="on"
BLOCK_REPORTS="on"

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null || die "'$1' is required but not installed."; }

check_sha256() { # file expected
  local actual
  actual="$(sha256sum "$1" | cut -d' ' -f1)"
  [[ "${actual}" == "$2" ]] || die "checksum mismatch for $(basename "$1") — refusing to continue."
}

stop_spotify() {
  pgrep -x spotify >/dev/null || return 0
  info "closing Spotify"
  # Spotify ignores SIGTERM for a long time; its own Quit command works at once.
  busctl --user call "${MPRIS}" /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2 Quit >/dev/null 2>&1 \
    || pkill -x spotify || true
  for _ in $(seq 1 50); do
    pgrep -x spotify >/dev/null || return 0
    sleep 0.2
  done
  die "Spotify is still running. Close it and run the installer again."
}

check_system() {
  say "Checking the system"
  [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || die "v0 supports Linux x86_64 only."
  [[ "${EUID}" -ne 0 ]] || die "run as your normal user, not as root (sudo is asked for when needed)."
  for tool in curl tar sha256sum dpkg-query sudo; do need "${tool}"; done
  [[ -x "${SPOTIFY_DIR}/spotify" ]] \
    || die "Spotify not found in ${SPOTIFY_DIR}. v0 supports the official apt package only (not snap/flatpak)."
  [[ -f "${HOME}/.config/spotify/prefs" ]] \
    || die "open Spotify once and log in, then run the installer again."
  local installed
  installed="$(dpkg-query -W -f='${Version}' spotify-client 2>/dev/null | sed 's/^[0-9]*://')"
  if [[ "${installed}" == "${SPOTIFY_LINUX}" ]]; then
    info "Spotify ${installed} (tested version)"
  else
    info "WARNING: Spotify ${installed:-unknown} is installed; tested version is ${SPOTIFY_LINUX}."
    info "It may still work, but it was not tested."
  fi
}

hold_updates() {
  say "Blocking Spotify auto-updates"
  if apt-mark showhold | grep -qx spotify-client; then
    info "already on hold"
  else
    sudo apt-mark hold spotify-client >/dev/null
    info "spotify-client is now on hold (undo: sudo apt-mark unhold spotify-client)"
  fi
}

fix_permissions() {
  say "Folder permissions"
  if [[ -w "${SPOTIFY_DIR}" && -w "${SPOTIFY_DIR}/Apps" ]] \
     && ! find "${SPOTIFY_DIR}/Apps" ! -writable -print -quit | grep -q .; then
    info "already writable by ${USER}"
  else
    # Only this user gets write access (narrower than the usual 'chmod a+wr').
    sudo chown "${USER}" "${SPOTIFY_DIR}"
    sudo chown -R "${USER}" "${SPOTIFY_DIR}/Apps"
    info "${USER} now owns ${SPOTIFY_DIR} and ${SPOTIFY_DIR}/Apps"
  fi
}

install_spicetify() {
  say "Spicetify ${SPICETIFY_CLI}"
  if [[ -x "${SPICETIFY}" && "$("${SPICETIFY}" -v 2>/dev/null)" == "${SPICETIFY_CLI}" ]]; then
    info "already installed"
    return
  fi
  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/spicetify.tar.gz" \
    "https://github.com/spicetify/cli/releases/download/v${SPICETIFY_CLI}/spicetify-${SPICETIFY_CLI}-linux-amd64.tar.gz"
  check_sha256 "${tmp}/spicetify.tar.gz" "${SPICETIFY_CLI_SHA256_LINUX_AMD64}"
  mkdir -p "${SPICETIFY_HOME}"
  tar -xzf "${tmp}/spicetify.tar.gz" -C "${SPICETIFY_HOME}"
  rm -rf "${tmp}"
  info "installed into ${SPICETIFY_HOME}"
}

install_adblockify() {
  say "adblockify (${ADBLOCKIFY_COMMIT:0:7})"
  local target="${SPICETIFY_CONFIG_DIR}/Extensions/${EXTENSION}"
  local marker="adblockify ${ADBLOCKIFY_COMMIT} sha256:${ADBLOCKIFY_SHA256} wrapper:1"
  if [[ -f "${target}" ]] && grep -qF "${marker}" "${target}"; then
    info "already installed"
    return
  fi
  local tmp
  tmp="$(mktemp)"
  curl -fsSL -o "${tmp}" \
    "https://raw.githubusercontent.com/rxri/spicetify-extensions/${ADBLOCKIFY_COMMIT}/adblock/adblock.js"
  check_sha256 "${tmp}" "${ADBLOCKIFY_SHA256}"
  mkdir -p "$(dirname "${target}")"
  # The verified, unchanged file is wrapped in a check, so ad blocking can be
  # switched off in AI Playlists -> Settings (takes effect when Spotify restarts).
  {
    printf '// %s\n' "${marker}"
    printf '// adblockify by rxri (MIT): https://github.com/rxri/spicetify-extensions\n'
    printf '(function () {\n'
    printf '  try { if (localStorage.getItem("spotify-ai:adblock") === "off") return; } catch (e) {}\n'
    printf '  window.__spotifyAiAdblock = true;\n'
    cat "${tmp}"
    printf '\n})();\n'
  } > "${target}"
  rm -f "${tmp}" "${SPICETIFY_CONFIG_DIR}/Extensions/${OLD_EXTENSION}"
  info "installed"
}

install_agent() {
  say "AI Playlists app"
  [[ -f "${AGENT_SOURCE}/index.js" && -f "${AGENT_SOURCE}/manifest.json" ]] \
    || die "the app bundle is missing (${AGENT_SOURCE}). Re-download the repository."
  local target="${SPICETIFY_CONFIG_DIR}/CustomApps/${AGENT_APP}"
  if [[ -d "${target}" ]] && diff -rq "${AGENT_SOURCE}" "${target}" >/dev/null 2>&1; then
    info "already installed"
    return
  fi
  rm -rf "${target}"
  mkdir -p "$(dirname "${target}")"
  cp -r "${AGENT_SOURCE}" "${target}"
  info "installed"
}

load_options() {
  [[ -f "${OPTIONS_FILE}" ]] || return 0
  local key value
  while IFS='=' read -r key value; do
    case "${key}=${value}" in
      ADBLOCK=on|ADBLOCK=off) ADBLOCK="${value}" ;;
      BLOCK_REPORTS=on|BLOCK_REPORTS=off) BLOCK_REPORTS="${value}" ;;
    esac
  done < "${OPTIONS_FILE}"
}

save_options() {
  mkdir -p "$(dirname "${OPTIONS_FILE}")"
  printf 'ADBLOCK=%s\nBLOCK_REPORTS=%s\n' "${ADBLOCK}" "${BLOCK_REPORTS}" > "${OPTIONS_FILE}"
}

on_off() { # value flag-name
  [[ "$1" == "on" || "$1" == "off" ]] || die "$2 needs 'on' or 'off'."
}

configure() {
  say "Configuring Spicetify"
  "${SPICETIFY}" config >/dev/null 2>&1 || true            # creates the config on first run
  local ini="${SPICETIFY_CONFIG_DIR}/config-xpui.ini"
  [[ -f "${ini}" ]] || die "Spicetify did not create its config (${ini})."
  # No themes, no recolouring: we only need the platform. Keeps idle cost at zero.
  "${SPICETIFY}" config inject_css 0 replace_colors 0 >/dev/null
  # We ship pinned versions, so Spicetify's own update check would only add a request at startup.
  "${SPICETIFY}" config check_spicetify_update 0 >/dev/null
  if grep -E '^extensions' "${ini}" | tr '|=' '  ' | grep -qw "${OLD_EXTENSION}"; then
    "${SPICETIFY}" config extensions "${OLD_EXTENSION}-" >/dev/null   # replaced by the switchable one
  fi
  local has_ext=0
  grep -E '^extensions' "${ini}" | grep -qF "${EXTENSION}" && has_ext=1
  if [[ "${ADBLOCK}" == "on" && "${has_ext}" == 0 ]]; then
    "${SPICETIFY}" config extensions "${EXTENSION}" >/dev/null
  elif [[ "${ADBLOCK}" == "off" && "${has_ext}" == 1 ]]; then
    "${SPICETIFY}" config extensions "${EXTENSION}-" >/dev/null
  fi
  local reports=1
  [[ "${BLOCK_REPORTS}" == "off" ]] && reports=0
  "${SPICETIFY}" config disable_sentry "${reports}" disable_ui_logging "${reports}" >/dev/null
  info "ad blocking: ${ADBLOCK}; crash reports and interface logs to Spotify blocked: ${BLOCK_REPORTS}"
  if ! grep -E '^custom_apps' "${ini}" | grep -qw "${AGENT_APP}"; then
    "${SPICETIFY}" config custom_apps "${AGENT_APP}" >/dev/null
  fi
  info "ok"
}

apply() {
  say "Applying to Spotify"
  stop_spotify
  # Start from Spotify's own files every time: this is what makes a re-run a repair.
  if [[ -d "${SPOTIFY_DIR}/Apps/xpui" ]]; then
    "${SPICETIFY}" restore >/dev/null 2>&1 \
      || die "Spotify files are modified but Spicetify has no backup. Reinstall Spotify (sudo apt install --reinstall spotify-client) and run again."
  fi
  "${SPICETIFY}" clear >/dev/null 2>&1 || true
  "${SPICETIFY}" backup apply >/dev/null 2>&1 || die "Spicetify could not patch this Spotify version."
  if [[ "${ADBLOCK}" == "on" ]]; then
    [[ -f "${SPOTIFY_DIR}/Apps/xpui/extensions/${EXTENSION}" ]] || die "the ad-blocking extension was not applied."
  else
    [[ ! -f "${SPOTIFY_DIR}/Apps/xpui/extensions/${EXTENSION}" ]] || die "the ad-blocking extension is still applied."
  fi
  ls "${SPOTIFY_DIR}/Apps/xpui/" | grep -q "spicetify-routes-${AGENT_APP}" || die "the AI Playlists app was not applied."
  info "done"
}

uninstall() {
  say "Uninstalling"
  stop_spotify
  if [[ -x "${SPICETIFY}" && -d "${SPOTIFY_DIR}/Apps/xpui" ]]; then
    "${SPICETIFY}" restore >/dev/null 2>&1 && info "Spotify files restored" \
      || info "WARNING: restore failed — run: sudo apt install --reinstall spotify-client"
  fi
  rm -rf "${SPICETIFY_HOME}" "${SPICETIFY_CONFIG_DIR}" "$(dirname "${OPTIONS_FILE}")"
  info "Spicetify removed"
  info "asking for sudo to give the Spotify folder back to root and allow updates"
  sudo chown -R root "${SPOTIFY_DIR}/Apps" && sudo chown root "${SPOTIFY_DIR}" && info "folder owner restored"
  sudo apt-mark unhold spotify-client >/dev/null && info "updates allowed again"
  say "Done. Spotify is back to its original state."
}

main() {
  load_options
  local action="install"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --uninstall) action="uninstall" ;;
      --adblock) on_off "${2:-}" "--adblock"; ADBLOCK="$2"; shift ;;
      --block-reports) on_off "${2:-}" "--block-reports"; BLOCK_REPORTS="$2"; shift ;;
      *) die "unknown option '$1'. See the top of this file for the options." ;;
    esac
    shift
  done

  check_system
  if [[ "${action}" == "uninstall" ]]; then
    uninstall
    return
  fi
  save_options
  hold_updates
  fix_permissions
  install_spicetify
  install_adblockify
  install_agent
  configure
  apply
  say "Done. Start Spotify as usual. The AI Playlists button is in the top bar, left of Home."
}

main "$@"
