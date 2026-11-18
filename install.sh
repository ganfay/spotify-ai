#!/usr/bin/env bash
# spotify-ai installer — Linux (Spotify from the official apt repository) and macOS.
#
# From a copy of the repository:
#   ./install.sh                     install or repair (safe to run again)
# Without one (downloads what it needs from GitHub):
#   curl -fsSL https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.sh | bash
#   (options then go after "bash -s --", for example: ... | bash -s -- --uninstall)
#
#   --adblock off         do not install the ad blocker at all (default: on;
#                         when installed it can also be switched in the app's Settings)
#   --block-reports off   let Spotify send crash reports and interface logs to its
#                         developers (on = stop them, the default)
#   --force               macOS: try even when Spotify is newer than the tested version
#   --clean-spotify yes   macOS: when the installed Spotify was changed by another mod,
#                         replace it with a clean copy without asking (no = keep it)
#   --uninstall           return Spotify to its original state
#
# Choices are remembered, so a later plain run keeps them.
# Listening statistics (Recently played, Wrapped) are never blocked.
#
# What it does (variant B, docs/DECISIONS.md):
#   1. macOS only: installs Spotify from Spotify's own server if it is missing;
#   2. stops Spotify auto-updates (Linux: apt hold; macOS: a locked updater folder);
#   3. Linux only: lets your user write to the Spotify folder (needed by Spicetify);
#   4. installs Spicetify at a pinned version into ~/.spicetify;
#   5. installs the adblockify extension at a pinned commit;
#   6. installs the AI Playlists app;
#   7. applies everything to Spotify.
# Downloads are checked by SHA-256 (Spotify's own disk image: by its code signature).
# Windows has its own installer: install.cmd / install.ps1.
# Must run with the bash 3.2 that macOS ships.

set -euo pipefail

BASE_URL="${SPOTIFY_AI_BASE_URL:-https://raw.githubusercontent.com/ganfay/spotify-ai/main}"
HERE=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
WORK=""   # temporary folder, removed on exit

SPICETIFY_HOME="${HOME}/.spicetify"
SPICETIFY="${SPICETIFY_HOME}/spicetify"
SPICETIFY_CONFIG_DIR="${HOME}/.config/spicetify"
EXTENSION="spotify-ai-adblock.js"
OLD_EXTENSION="adblock.js"   # name used by earlier versions of this installer
AGENT_APP="ai-playlists"
AGENT_SOURCE=""
MPRIS="org.mpris.MediaPlayer2.spotify"
OPTIONS_FILE="${HOME}/.config/spotify-ai/options"
# Spicetify's "restore" deletes this file of Spotify and never brings it back. A copy
# is kept here and returned on uninstall, so that Spotify really is as it was
# (on macOS its signature is valid again).
KEEP_DIR="${HOME}/.config/spotify-ai/originals"
KEEP_FILE="native-licenses.html"
# Written when THIS installer put Spicetify there. Without it, uninstall leaves a
# Spicetify the user set up themselves alone and removes only our parts.
OURS_MARKER="${SPICETIFY_HOME}/.installed-by-spotify-ai"
ME="$(id -un)"

# Set by detect_os.
OS=""              # linux | macos
ARCH=""            # amd64 | arm64 (as in Spicetify's file names)
SPOTIFY_DIR=""     # the folder that holds Apps/
SPOTIFY_APP="/Applications/Spotify.app"
PREFS=""
PROCESS=""
REINSTALL_HINT=""
UPDATE_DIR="${HOME}/Library/Application Support/Spotify/PersistentCache/Update"
FORCE=0
CLEAN_SPOTIFY=""   # yes | no | "" = ask in the terminal

# Defaults; overwritten by the saved choices and then by command-line flags.
ADBLOCK="on"
BLOCK_REPORTS="on"

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null || die "'$1' is required but not installed."; }

cleanup() { [[ -z "${WORK}" ]] || rm -rf "${WORK}"; }

detect_os() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      OS="linux"; ARCH="amd64"
      SPOTIFY_DIR="/usr/share/spotify"
      PREFS="${HOME}/.config/spotify/prefs"
      PROCESS="spotify"
      REINSTALL_HINT="sudo apt install --reinstall spotify-client"
      ;;
    Darwin-arm64|Darwin-x86_64)
      OS="macos"; ARCH="arm64"
      [[ "$(uname -m)" == "x86_64" ]] && ARCH="amd64"
      SPOTIFY_DIR="${SPOTIFY_APP}/Contents/Resources"
      PREFS="${HOME}/Library/Application Support/Spotify/prefs"
      PROCESS="Spotify"
      REINSTALL_HINT="delete Spotify from Applications and install it again from https://www.spotify.com/download"
      ;;
    *) die "this system ($(uname -s) $(uname -m)) is not supported. Linux x86_64 and macOS only; Windows uses install.cmd." ;;
  esac
}

# The files of this repository: next to this script, or downloaded from GitHub.
load_sources() {
  if [[ -n "${HERE}" && -f "${HERE}/versions" && -f "${HERE}/agent/release/${AGENT_APP}/index.js" ]]; then
    AGENT_SOURCE="${HERE}/agent/release/${AGENT_APP}"
  else
    say "Downloading spotify-ai"
    need curl
    AGENT_SOURCE="${WORK}/${AGENT_APP}"
    mkdir -p "${AGENT_SOURCE}"
    local file
    curl -fsSL -o "${WORK}/versions" "${BASE_URL}/versions" || die "could not download from ${BASE_URL}. Check the internet connection."
    for file in index.js manifest.json; do
      curl -fsSL -o "${AGENT_SOURCE}/${file}" "${BASE_URL}/agent/release/${AGENT_APP}/${file}" \
        || die "could not download ${file} from ${BASE_URL}."
    done
    HERE="${WORK}"
    info "ok"
  fi
  # shellcheck source=versions
  source "${HERE}/versions"
}

sha256_of() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# True when version $1 is newer than $2 (only the first three numbers count).
version_gt() {
  awk -v a="$1" -v b="$2" 'BEGIN { split(a, x, "."); split(b, y, ".");
    for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 1 }'
}

check_sha256() { # file expected
  local actual
  actual="$(sha256_of "$1")"
  [[ "${actual}" == "$2" ]] || die "checksum mismatch for $(basename "$1") — refusing to continue."
}

stop_spotify() {
  pgrep -x "${PROCESS}" >/dev/null || return 0
  info "closing Spotify"
  if [[ "${OS}" == "macos" ]]; then
    osascript -e 'quit app "Spotify"' >/dev/null 2>&1 || pkill -x "${PROCESS}" || true
  else
    # Spotify ignores SIGTERM for a long time; its own Quit command works at once.
    busctl --user call "${MPRIS}" /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2 Quit >/dev/null 2>&1 \
      || pkill -x "${PROCESS}" || true
  fi
  local i
  for i in $(seq 1 50); do
    pgrep -x "${PROCESS}" >/dev/null || return 0
    # macOS: the polite request can be ignored (a dialog is open); insist after 4 seconds.
    [[ "${OS}" == "macos" && "${i}" == 20 ]] && { pkill -x "${PROCESS}" || true; }
    sleep 0.2
  done
  die "Spotify is still running. Close it and run the installer again."
}

prefs_ready() { grep -q 'app.last-launched-version' "${PREFS}" 2>/dev/null; }

wait_prefs() { # seconds
  local i
  for i in $(seq 1 "$1"); do
    prefs_ready && return 0
    sleep 1
  done
  return 1
}

# NOTE for this whole file: never write "command | grep -q" — the script runs with
# pipefail, grep -q stops reading at the first match, the command before it is then
# killed by the closed pipe, and the whole test counts as FAILED on some machines.
# Read the output into a variable, or let grep read to the end (>/dev/null).

# macOS marks files that came from the internet ("quarantine") and checks such an
# app's signature when it is opened. A patched Spotify no longer matches its
# signature, so with the mark macOS says "Spotify is damaged" and refuses to open
# it. The mark is removed; the copy we install ourselves was verified before that.
clear_quarantine() {
  [[ "${OS}" == "macos" ]] || return 0
  xattr -dr com.apple.quarantine "${SPOTIFY_APP}" 2>/dev/null || true
}

# True when the app carries Spotify's own developer signature.
signed_by_spotify() { # path to Spotify.app
  local details
  details="$(codesign -dv --verbose=2 "$1" 2>&1 || true)"
  [[ "${details}" == *"Authority=Developer ID Application: Spotify"* ]]
}

# Puts a fresh Spotify from Spotify's server into Applications. An existing copy is
# replaced only after the new one has been downloaded, checked and copied.
install_spotify_macos() {
  say "Installing Spotify"
  local name="Spotify.dmg"
  [[ "${ARCH}" == "arm64" ]] && name="SpotifyARM64.dmg"
  local dmg="${WORK}/Spotify.dmg" mount="${WORK}/spotify-dmg" fresh="/Applications/Spotify.spotify-ai-new.app"
  info "downloading https://download.scdn.co/${name}"
  curl -fSL --progress-bar -o "${dmg}" "https://download.scdn.co/${name}" || die "could not download Spotify. Nothing was changed."
  hdiutil attach "${dmg}" -nobrowse -readonly -quiet -mountpoint "${mount}" || die "could not open the Spotify disk image. Nothing was changed."
  local problem=""
  problem="$(codesign --verify --deep --strict "${mount}/Spotify.app" 2>&1)" || problem="${problem:-signature check failed}"
  if [[ -z "${problem}" ]] && ! signed_by_spotify "${mount}/Spotify.app"; then
    problem="it is not signed with Spotify's developer certificate"
  fi
  if [[ -z "${problem}" ]]; then
    rm -rf "${fresh}"
    ditto "${mount}/Spotify.app" "${fresh}" || problem="copy"
  fi
  hdiutil detach "${mount}" -quiet || true
  if [[ "${problem}" == "copy" ]]; then
    rm -rf "${fresh}"
    die "could not copy Spotify into Applications. Nothing was changed. Install it from https://www.spotify.com/download and run this again."
  fi
  [[ -z "${problem}" ]] || die "the downloaded Spotify did not pass the signature check, so it was not installed and nothing was changed. Reason: ${problem}"
  rm -rf "${SPOTIFY_APP}"
  mv "${fresh}" "${SPOTIFY_APP}" || die "could not put the new Spotify in place. It is in ${fresh}: rename it to Spotify.app."
  clear_quarantine
  info "Spotify installed"
}

check_macos() {
  for tool in curl tar shasum defaults awk osascript chflags xattr; do need "${tool}"; done
  if [[ ! -d "${SPOTIFY_APP}" ]]; then
    [[ ! -d "${HOME}/Applications/Spotify.app" ]] \
      || die "Spotify is in your personal Applications folder. Move it to the main Applications folder and run this again."
    [[ "${1}" == "install" ]] || die "Spotify is not installed: nothing to uninstall."
    for tool in hdiutil codesign ditto; do need "${tool}"; done
    install_spotify_macos
  fi
  if [[ "${1}" == "install" ]] && ! prefs_ready; then
    info "Spotify has not been opened yet: opening it once"
    open "${SPOTIFY_APP}" || true
    wait_prefs 90 || die "open Spotify, log in, close it, then run the installer again."
  fi
  [[ "${1}" == "install" ]] || return 0
  check_version_macos
}

check_version_macos() {
  local installed
  installed="$(defaults read "${SPOTIFY_APP}/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
  if [[ -z "${installed}" ]]; then
    info "WARNING: cannot read the Spotify version. Continuing."
  elif ! version_gt "${installed}" "${SPOTIFY_MAX}"; then
    info "Spotify ${installed} (supported)"
  elif [[ "${FORCE}" == 1 ]]; then
    info "WARNING: Spotify ${installed} is newer than the tested ${SPOTIFY_MAX}. Trying anyway (--force)."
  else
    die "Spotify ${installed} is newer than the newest version this installer supports (${SPOTIFY_MAX}). Spotify was not changed. Support usually follows within a week: run the newest installer again then."
  fi
}

# True when the app is exactly what Spotify shipped: signed by Spotify, nothing changed inside.
spotify_is_original() {
  codesign --verify --deep --strict "${SPOTIFY_APP}" >/dev/null 2>&1 && signed_by_spotify "${SPOTIFY_APP}"
}

# Asks a yes/no question in the terminal (Enter = yes). With --clean-spotify the
# answer is given; with nobody to ask, the answer is no.
ask_yes() {
  if [[ -n "${CLEAN_SPOTIFY}" ]]; then
    [[ "${CLEAN_SPOTIFY}" == "yes" ]]
    return
  fi
  local answer=""
  # The script itself may be arriving on standard input (curl | bash), so the
  # question is written to, and the answer read from, the terminal directly.
  { printf '    %s [Y/n] ' "$1" > /dev/tty; } 2>/dev/null || return 1
  { read -r answer < /dev/tty; } 2>/dev/null || return 1
  case "${answer}" in
    n|N|no|No|NO) return 1 ;;
    *) return 0 ;;
  esac
}

# macOS, first install only: a Spotify changed by another mod (SpotX, a "cracked"
# copy …) is a bad base. Offer to put Spotify's own copy in its place.
ensure_clean_spotify() {
  [[ "${OS}" == "macos" ]] || return 0
  # Already patched by Spicetify (ours or the user's): the backup is the base, nothing to check here.
  [[ ! -d "${SPOTIFY_DIR}/Apps/xpui" ]] || return 0
  say "Checking that Spotify is original"
  need codesign
  if spotify_is_original; then
    info "ok: signed by Spotify, nothing changed"
    return 0
  fi
  local why
  why="$(codesign --verify --deep --strict "${SPOTIFY_APP}" 2>&1 | head -n 2 | tr '\n' ' ' || true)"
  info "This Spotify was modified (another mod, or a cracked copy). ${why:+[${why}]}"
  info "A clean one from Spotify can replace it: you stay logged in, playlists are safe."
  info "(Keeping it: ads may stay, AI Playlists may not appear, Spotify may open empty.)"
  if ! ask_yes "Replace it with a clean Spotify?"; then
    info "WARNING: keeping the modified Spotify. If something does not work, run this again and answer yes."
    return 0
  fi
  local tool
  for tool in hdiutil codesign ditto; do need "${tool}"; done
  stop_spotify
  install_spotify_macos
  # Let the new copy start once, so that it records its own version.
  open "${SPOTIFY_APP}" || true
  sleep 12
  stop_spotify
  check_version_macos
}

check_system() { # install | uninstall
  say "Checking the system"
  [[ "${EUID}" -ne 0 ]] || die "run as your normal user, not as root (the password is asked for when needed)."
  local tool
  if [[ "${OS}" == "macos" ]]; then
    check_macos "$1"
    return
  fi
  for tool in curl tar sha256sum dpkg-query sudo; do need "${tool}"; done
  [[ -x "${SPOTIFY_DIR}/spotify" ]] \
    || die "Spotify not found in ${SPOTIFY_DIR}. On Linux only the official apt package is supported (not snap/flatpak)."
  [[ -f "${PREFS}" ]] \
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
  if [[ "${OS}" == "macos" ]]; then
    stop_spotify
    # The updater downloads into this folder. Locked, it cannot (the same thing
    # "spicetify spotify-updates block" does).
    if [[ -d "${UPDATE_DIR}" && "$(stat -f %Sf "${UPDATE_DIR}" 2>/dev/null)" == *uchg* ]]; then
      info "already blocked"
    else
      chflags nouchg "${UPDATE_DIR}" 2>/dev/null || true
      rm -rf "${UPDATE_DIR}"
      mkdir -p "${UPDATE_DIR}"
      chflags uchg "${UPDATE_DIR}" && info "blocked (the uninstaller undoes this)" \
        || info "WARNING: could not lock the updater folder. After a Spotify update just run the installer again."
    fi
    return
  fi
  if apt-mark showhold | grep -x spotify-client >/dev/null; then
    info "already on hold"
  else
    sudo apt-mark hold spotify-client >/dev/null
    info "spotify-client is now on hold (undo: sudo apt-mark unhold spotify-client)"
  fi
}

fix_permissions() {
  say "Folder permissions"
  if [[ "${OS}" == "macos" ]]; then
    local probe="${SPOTIFY_DIR}/.spotify-ai-write-test"
    if ( : > "${probe}" ) 2>/dev/null; then
      rm -f "${probe}"
      info "this terminal may change Spotify"
      return
    fi
    die "macOS does not let this terminal change apps. Open System Settings > Privacy & Security > App Management, switch on the terminal app you are using (Terminal), close the terminal completely, open it again and run the installer again."
  fi
  if [[ -w "${SPOTIFY_DIR}" && -w "${SPOTIFY_DIR}/Apps" ]] \
     && [[ -z "$(find "${SPOTIFY_DIR}/Apps" ! -writable -print -quit)" ]]; then
    info "already writable by ${ME}"
  else
    # Only this user gets write access (narrower than the usual 'chmod a+wr').
    sudo chown "${ME}" "${SPOTIFY_DIR}"
    sudo chown -R "${ME}" "${SPOTIFY_DIR}/Apps"
    info "${ME} now owns ${SPOTIFY_DIR} and ${SPOTIFY_DIR}/Apps"
  fi
}

install_spicetify() {
  say "Spicetify ${SPICETIFY_CLI}"
  if [[ -x "${SPICETIFY}" && "$("${SPICETIFY}" -v 2>/dev/null)" == "${SPICETIFY_CLI}" ]]; then
    info "already installed"
    return
  fi
  local fresh=1
  [[ -e "${SPICETIFY_HOME}" || -e "${SPICETIFY_CONFIG_DIR}" ]] && fresh=0
  local tmp
  tmp="$(mktemp -d)"
  local asset expected
  case "${OS}-${ARCH}" in
    linux-amd64) asset="linux-amd64";  expected="${SPICETIFY_CLI_SHA256_LINUX_AMD64}" ;;
    macos-arm64) asset="darwin-arm64"; expected="${SPICETIFY_CLI_SHA256_DARWIN_ARM64}" ;;
    macos-amd64) asset="darwin-amd64"; expected="${SPICETIFY_CLI_SHA256_DARWIN_AMD64}" ;;
  esac
  curl -fsSL -o "${tmp}/spicetify.tar.gz" \
    "https://github.com/spicetify/cli/releases/download/v${SPICETIFY_CLI}/spicetify-${SPICETIFY_CLI}-${asset}.tar.gz"
  check_sha256 "${tmp}/spicetify.tar.gz" "${expected}"
  mkdir -p "${SPICETIFY_HOME}"
  tar -xzf "${tmp}/spicetify.tar.gz" -C "${SPICETIFY_HOME}"
  rm -rf "${tmp}"
  [[ "${fresh}" == 1 ]] && : > "${OURS_MARKER}"
  info "installed into ${SPICETIFY_HOME}"
}

install_adblockify() {
  say "adblockify (${ADBLOCKIFY_COMMIT:0:7})"
  local target="${SPICETIFY_CONFIG_DIR}/Extensions/${EXTENSION}"
  local marker="adblockify ${ADBLOCKIFY_COMMIT} sha256:${ADBLOCKIFY_SHA256} wrapper:2"
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
    # The original file goes into its own function, unchanged, so that its
    # leading "use strict" is still the first statement of a function body.
    printf '  (function () {\n'
    cat "${tmp}"
    printf '\n  })();\n'
    printf '})();\n'
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
  if grep -E '^extensions' "${ini}" | tr '|=' '  ' | grep -w "${OLD_EXTENSION}" >/dev/null; then
    "${SPICETIFY}" config extensions "${OLD_EXTENSION}-" >/dev/null   # replaced by the switchable one
  fi
  local has_ext=0
  grep -E '^extensions' "${ini}" | grep -F "${EXTENSION}" >/dev/null && has_ext=1
  if [[ "${ADBLOCK}" == "on" && "${has_ext}" == 0 ]]; then
    "${SPICETIFY}" config extensions "${EXTENSION}" >/dev/null
  elif [[ "${ADBLOCK}" == "off" && "${has_ext}" == 1 ]]; then
    "${SPICETIFY}" config extensions "${EXTENSION}-" >/dev/null
  fi
  local reports=1
  [[ "${BLOCK_REPORTS}" == "off" ]] && reports=0
  "${SPICETIFY}" config disable_sentry "${reports}" disable_ui_logging "${reports}" >/dev/null
  info "ad blocking: ${ADBLOCK}; crash reports and interface logs to Spotify blocked: ${BLOCK_REPORTS}"
  if ! grep -E '^custom_apps' "${ini}" | grep -w "${AGENT_APP}" >/dev/null; then
    "${SPICETIFY}" config custom_apps "${AGENT_APP}" >/dev/null
  fi
  info "ok"
}

installed_version() {
  if [[ "${OS}" == "macos" ]]; then
    defaults read "${SPOTIFY_APP}/Contents/Info" CFBundleShortVersionString 2>/dev/null || true
  else
    dpkg-query -W -f='${Version}' spotify-client 2>/dev/null || true
  fi
}

keep_original_file() {
  local file="${SPOTIFY_DIR}/Apps/${KEEP_FILE}"
  [[ -f "${file}" ]] || return 0
  mkdir -p "${KEEP_DIR}"
  cp "${file}" "${KEEP_DIR}/${KEEP_FILE}"
  installed_version > "${KEEP_DIR}/version"
}

return_original_file() {
  local file="${SPOTIFY_DIR}/Apps/${KEEP_FILE}"
  [[ -f "${KEEP_DIR}/${KEEP_FILE}" && ! -e "${file}" ]] || return 0
  # Only into the Spotify version it was taken from.
  [[ "$(cat "${KEEP_DIR}/version" 2>/dev/null)" == "$(installed_version)" ]] || return 0
  cp "${KEEP_DIR}/${KEEP_FILE}" "${file}" 2>/dev/null || true
}

apply() {
  say "Applying to Spotify"
  stop_spotify
  keep_original_file
  # Start from Spotify's own files every time: this is what makes a re-run a repair.
  if [[ -d "${SPOTIFY_DIR}/Apps/xpui" ]]; then
    "${SPICETIFY}" restore >/dev/null 2>&1 \
      || die "Spotify files are modified but Spicetify has no backup. Reinstall Spotify (${REINSTALL_HINT}) and run again."
  fi
  "${SPICETIFY}" clear >/dev/null 2>&1 || true
  "${SPICETIFY}" backup apply >/dev/null 2>&1 || die "Spicetify could not patch this Spotify version."
  if [[ "${ADBLOCK}" == "on" ]]; then
    [[ -f "${SPOTIFY_DIR}/Apps/xpui/extensions/${EXTENSION}" ]] || die "the ad-blocking extension was not applied."
  else
    [[ ! -f "${SPOTIFY_DIR}/Apps/xpui/extensions/${EXTENSION}" ]] || die "the ad-blocking extension is still applied."
  fi
  compgen -G "${SPOTIFY_DIR}/Apps/xpui/spicetify-routes-${AGENT_APP}*" >/dev/null || die "the AI Playlists app was not applied."
  clear_quarantine
  info "done"
}

uninstall() {
  say "Uninstalling"
  stop_spotify
  local restored=1
  if [[ -x "${SPICETIFY}" && -d "${SPOTIFY_DIR}/Apps/xpui" ]]; then
    if "${SPICETIFY}" restore >/dev/null 2>&1; then
      return_original_file
      info "Spotify files restored"
    else
      restored=0
    fi
  fi
  if [[ "${restored}" == 0 ]]; then
    # Nothing is deleted: the backup Spicetify holds may still be needed.
    die "could not restore Spotify's files. Nothing was removed. To reset Spotify: ${REINSTALL_HINT} — and then run this again."
  fi

  local ours=0
  [[ -f "${OURS_MARKER}" ]] && ours=1
  if [[ "${ours}" == 1 ]]; then
    rm -rf "${SPICETIFY_HOME}" "${SPICETIFY_CONFIG_DIR}"
    info "Spicetify removed"
  elif [[ -x "${SPICETIFY}" ]]; then
    # Spicetify was here before us: remove only what this installer added.
    rm -f "${SPICETIFY_CONFIG_DIR}/Extensions/${EXTENSION}"
    rm -rf "${SPICETIFY_CONFIG_DIR}/CustomApps/${AGENT_APP}"
    "${SPICETIFY}" config extensions "${EXTENSION}-" custom_apps "${AGENT_APP}-" >/dev/null 2>&1 || true
    "${SPICETIFY}" backup apply >/dev/null 2>&1 || true
    info "our extension and app removed; your own Spicetify setup was kept"
  fi
  rm -rf "$(dirname "${OPTIONS_FILE}")"

  if [[ "${OS}" == "macos" ]]; then
    if [[ "${ours}" == 1 || ! -x "${SPICETIFY}" ]]; then
      if [[ -d "${UPDATE_DIR}" ]]; then
        chflags nouchg "${UPDATE_DIR}" 2>/dev/null || true
        rm -rf "${UPDATE_DIR}" && info "updates allowed again"
      fi
      rm -rf "${HOME}/.local/state/spicetify"
      say "Done. Spotify is back to its original state."
    else
      say "Done. Our parts are removed; Spicetify itself and the update block were left as they are."
    fi
  elif [[ "${ours}" == 1 || ! -x "${SPICETIFY}" ]]; then
    info "asking for sudo to give the Spotify folder back to root and allow updates"
    sudo chown -R root "${SPOTIFY_DIR}/Apps" && sudo chown root "${SPOTIFY_DIR}" && info "folder owner restored"
    sudo apt-mark unhold spotify-client >/dev/null && info "updates allowed again"
    say "Done. Spotify is back to its original state."
  else
    say "Done. Our parts are removed; Spicetify itself, the folder permissions and the update hold were left as they are."
  fi
  info "Note: settings saved inside Spotify (including an API key you entered) are not removed."
  info "To clear them: AI Playlists > Settings before uninstalling, or delete Spotify's local data."
}

main() {
  detect_os
  WORK="$(mktemp -d)"
  trap cleanup EXIT
  load_options
  local action="install"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --uninstall) action="uninstall" ;;
      --force) FORCE=1 ;;
      --clean-spotify) [[ "${2:-}" == "yes" || "${2:-}" == "no" ]] || die "--clean-spotify needs 'yes' or 'no'."; CLEAN_SPOTIFY="$2"; shift ;;
      --adblock) on_off "${2:-}" "--adblock"; ADBLOCK="$2"; shift ;;
      --block-reports) on_off "${2:-}" "--block-reports"; BLOCK_REPORTS="$2"; shift ;;
      *) die "unknown option '$1'. See the top of install.sh for the options." ;;
    esac
    shift
  done

  load_sources
  check_system "${action}"
  if [[ "${action}" == "uninstall" ]]; then
    uninstall
    return
  fi
  save_options
  hold_updates
  fix_permissions
  ensure_clean_spotify
  install_spicetify
  install_adblockify
  install_agent
  configure
  apply
  say "Done. Start Spotify as usual. The AI Playlists button is in the top bar, left of Home."
  if [[ "${OS}" == "macos" ]]; then
    info "starting Spotify"
    open "${SPOTIFY_APP}" || true
  fi
}

main "$@"
