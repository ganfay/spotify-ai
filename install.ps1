# spotify-ai installer for Windows.
#
# Easiest way: double-click install.cmd (it runs this file).
# Or paste this into PowerShell:
#   irm https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1 | iex
#
# Pasted that way it takes no options; set $env:SPOTIFY_AI_UNINSTALL = '1' (or
# SPOTIFY_AI_FORCE) first, or use uninstall.cmd.
#
# Options (when run as a file, or through install.cmd):
#   -Uninstall           return Spotify to its original state
#   -Adblock off         do not install the ad blocker at all (default: on; when installed
#                        it can also be switched in the app's Settings)
#   -BlockReports off    let Spotify send crash reports and interface logs to its developers
#   -Force               try even when Spotify is newer than the tested version
#   -NoLaunch            do not start Spotify at the end
#   -CleanSpotify yes    when the installed Spotify was changed by another mod, replace it
#                        with a clean copy without asking (no = keep it)
#
# Choices are remembered, so a later plain run keeps them.
# Listening statistics (Recently played, Wrapped) are never blocked.
#
# What it does (the same as install.sh on Linux, see docs/DECISIONS.md):
#   1. installs Spotify from Spotify's own server if it is missing;
#   2. stops Spotify auto-updates (a locked file where the updater keeps its downloads);
#   3. installs Spicetify at a pinned version into %LOCALAPPDATA%\spicetify;
#   4. installs the adblockify extension at a pinned commit;
#   5. installs the AI Playlists app;
#   6. applies everything to Spotify.
# Downloads are checked by SHA-256 (Spotify's own installer: by its digital signature).
# Nothing needs administrator rights. This file must stay plain ASCII.

param(
  [switch]$Uninstall,
  [ValidateSet('', 'on', 'off')][string]$Adblock = '',
  [ValidateSet('', 'on', 'off')][string]$BlockReports = '',
  [switch]$Force,
  [switch]$NoLaunch,
  [ValidateSet('', 'yes', 'no')][string]$CleanSpotify = ''
)

# Options for the "irm | iex" way, where parameters cannot be passed. (Running a
# downloaded script block with parameters is a form Windows Defender blocks.)
if ($env:SPOTIFY_AI_UNINSTALL -eq '1') { $Uninstall = $true }
if ($env:SPOTIFY_AI_FORCE -eq '1') { $Force = $true }
if ($env:SPOTIFY_AI_CLEAN -eq 'yes' -or $env:SPOTIFY_AI_CLEAN -eq 'no') { $CleanSpotify = $env:SPOTIFY_AI_CLEAN }

function Install-SpotifyAi {
  param([bool]$Uninstall, [string]$Adblock, [string]$BlockReports, [bool]$Force, [bool]$NoLaunch, [string]$Here, [string]$CleanSpotify)

  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads very slow
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $BaseUrl = 'https://raw.githubusercontent.com/ganfay/spotify-ai/main'
  if ($env:SPOTIFY_AI_BASE_URL) { $BaseUrl = $env:SPOTIFY_AI_BASE_URL.TrimEnd('/') }

  $SpotifyDir = Join-Path $env:APPDATA 'Spotify'
  $SpotifyExe = Join-Path $SpotifyDir 'Spotify.exe'
  $Prefs = Join-Path $SpotifyDir 'prefs'
  $SpicetifyHome = Join-Path $env:LOCALAPPDATA 'spicetify'
  $Spicetify = Join-Path $SpicetifyHome 'spicetify.exe'
  $ConfigDir = Join-Path $env:APPDATA 'spicetify'
  $UpdateBlock = Join-Path $env:LOCALAPPDATA 'Spotify\Update'
  $OptionsFile = Join-Path $env:APPDATA 'spotify-ai\options'
  # Written when THIS installer put Spicetify there. Without it, uninstall leaves a
  # Spicetify the user set up themselves alone and removes only our parts.
  $OursMarker = Join-Path $SpicetifyHome '.installed-by-spotify-ai'
  $Extension = 'spotify-ai-adblock.js'
  $AgentApp = 'ai-playlists'
  $Utf8 = New-Object System.Text.UTF8Encoding($false)
  $Work = Join-Path ([IO.Path]::GetTempPath()) ('spotify-ai-' + [Guid]::NewGuid().ToString('N'))
  $Local = [bool]$Here -and (Test-Path -LiteralPath (Join-Path $Here 'versions'))
  $SpicetifyFlags = @()

  function Say($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
  function Info($text) { Write-Host "    $text" }

  function Get-Download($url, $dest) {
    try {
      Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    } catch {
      throw "could not download $url ($($_.Exception.Message)). Check the internet connection and run again."
    }
  }

  # A file of this repository: from the folder next to this script, or from GitHub.
  function Get-RepoFile($relative, $dest) {
    if ($Local) {
      $source = Join-Path $Here ($relative -replace '/', '\')
      if (-not (Test-Path -LiteralPath $source)) { throw "$relative is missing. Download the repository again." }
      Copy-Item -LiteralPath $source -Destination $dest -Force
    } else {
      Get-Download "$BaseUrl/$relative" $dest
    }
  }

  function Test-Sha256($file, $expected) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
    if ($actual -ne $expected) { throw "checksum mismatch for $(Split-Path $file -Leaf) - refusing to continue." }
  }

  # Runs Spicetify quietly; returns $true when it succeeded. (In Windows PowerShell 5.1
  # anything a program writes to its error stream stops a script unless handled like this.)
  function Invoke-Spicetify {
    $ErrorActionPreference = 'Continue'
    $all = @($SpicetifyFlags) + @($args)
    & $Spicetify @all 2>&1 | Out-Null
    return ($LASTEXITCODE -eq 0)
  }

  function Set-SpicetifyConfig {
    $all = @('config') + @($args)
    if (-not (Invoke-Spicetify @all)) { throw "Spicetify refused the setting: $($args -join ' ')" }
  }

  function Get-SpicetifyVersion {
    if (-not (Test-Path -LiteralPath $Spicetify)) { return '' }
    $ErrorActionPreference = 'Continue'
    $all = @($SpicetifyFlags) + @('-v')
    $out = (& $Spicetify @all 2>&1 | Out-String).Trim()
    return $out
  }

  function Get-Arch {
    $cpu = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $cpu = $env:PROCESSOR_ARCHITEW6432 }
    switch ($cpu) {
      'AMD64' { return 'x64' }
      'ARM64' { return 'arm64' }
      default { throw "this processor type ($cpu) is not supported: Spotify has no current 32-bit version." }
    }
  }

  function Stop-Spotify {
    $running = @(Get-Process -Name Spotify -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) { return }
    Info 'closing Spotify'
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 50; $i++) {
      if (@(Get-Process -Name Spotify -ErrorAction SilentlyContinue).Count -eq 0) { return }
      Start-Sleep -Milliseconds 200
    }
    throw 'Spotify is still running. Close it and run the installer again.'
  }

  function Test-PrefsReady {
    if (-not (Test-Path -LiteralPath $Prefs)) { return $false }
    return [bool](Select-String -LiteralPath $Prefs -SimpleMatch -Pattern 'app.last-launched-version' -Quiet)
  }

  function Wait-PrefsReady($seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
      # The program files, the interface package and the first-run settings must all be there.
      if ((Test-Path -LiteralPath $SpotifyExe) -and (Test-Path -LiteralPath (Join-Path $SpotifyDir 'Apps\xpui.spa')) -and (Test-PrefsReady)) { return $true }
      Start-Sleep -Seconds 1
    }
    return $false
  }

  function Remove-StoreSpotify {
    $store = $null
    try { $store = Get-AppxPackage -Name 'SpotifyAB.SpotifyMusic' -ErrorAction SilentlyContinue } catch { }
    if (-not $store) { return }
    Info 'Spotify from the Microsoft Store is installed. It cannot be modified.'
    Info 'It has to be replaced by the normal Spotify from spotify.com.'
    Info 'Your account, playlists and likes are not touched (they live on Spotify servers).'
    $answer = ''
    try { $answer = Read-Host '    Remove the Store version now? (y/n)' } catch { }
    if ($answer -notmatch '^(y|yes)$') {
      throw 'uninstall "Spotify" in Windows Settings > Apps, then run the installer again.'
    }
    Stop-Spotify
    Remove-AppxPackage -Package $store.PackageFullName
    Info 'Store version removed'
  }

  function Install-Spotify {
    Say 'Installing Spotify'
    $name = if ((Get-Arch) -eq 'arm64') { 'SpotifyFullSetupARM64.exe' } else { 'SpotifyFullSetupX64.exe' }
    $setup = Join-Path $Work $name
    Info "downloading https://download.scdn.co/$name"
    Get-Download "https://download.scdn.co/$name" $setup
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Spotify') {
      throw 'the downloaded Spotify installer is not signed by Spotify - refusing to run it.'
    }
    Info 'running the Spotify installer (Spotify opens when it is ready)'
    Start-Process -FilePath $setup
    if (-not (Wait-PrefsReady 300)) {
      throw 'Spotify did not finish installing. Install it from https://www.spotify.com/download , open it once, then run this again.'
    }
    Info 'Spotify installed'
  }

  # Signs that this Spotify was changed by something else. Returns a list of findings (empty = looks original).
  function Get-ModSigns {
    $signs = @()
    foreach ($name in 'Spotify.exe', 'Spotify.dll', 'chrome_elf.dll') {
      $file = Join-Path $SpotifyDir $name
      if (-not (Test-Path -LiteralPath $file)) { continue }
      $signature = Get-AuthenticodeSignature -LiteralPath $file
      if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Spotify') { $signs += "$name is not signed by Spotify (patched)" }
    }
    # Files that ad-blocking mods put next to Spotify.exe (BlockTheSpot and similar), and backups left by patchers (SpotX).
    foreach ($name in 'dpapi.dll', 'version.dll', 'config.ini', 'Spotify.bak', 'Spotify.dll.bak', 'chrome_elf.dll.bak', 'Apps\xpui.bak') {
      if (Test-Path -LiteralPath (Join-Path $SpotifyDir $name)) { $signs += "extra file $name" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $SpotifyDir 'Apps\xpui.spa'))) { $signs += 'the interface package Apps\xpui.spa is missing' }
    return $signs
  }

  function Confirm-Yes($question) {
    if ($CleanSpotify) { return ($CleanSpotify -eq 'yes') }
    $answer = $null
    try { $answer = Read-Host "    $question [Y/n]" } catch { return $false }   # nobody to ask: keep what is there
    return ($answer -notmatch '^(n|no)$')
  }

  # First install only: a Spotify changed by another mod is a bad base. Offer Spotify's own copy.
  function Repair-ModifiedSpotify {
    # Already patched by Spicetify (ours or the user's): its backup is the base, nothing to check here.
    if (Test-Path -LiteralPath (Join-Path $SpotifyDir 'Apps\xpui') -PathType Container) { return }
    Say 'Checking that Spotify is original'
    $signs = @(Get-ModSigns)
    if ($signs.Count -eq 0) { Info 'ok: signed by Spotify, no traces of other mods'; return }
    Info 'This Spotify does NOT look original:'
    foreach ($sign in $signs) { Info "  - $sign" }
    Info 'Replace it with a clean copy from the Spotify server? Your account, playlists and'
    Info 'likes are not touched, and you stay logged in.'
    Info '(If you keep the modified one: ad blocking or the AI Playlists button may not work,'
    Info ' Spotify may open as an empty window, and uninstalling will return Spotify to this'
    Info ' modified state, not to the original.)'
    if (-not (Confirm-Yes 'Replace Spotify with a clean copy?')) {
      Info 'WARNING: keeping the modified Spotify. If something does not work, run this again and answer yes.'
      return
    }
    Stop-Spotify
    # Everything of the program goes; the login and the settings ("prefs", "Users") stay.
    foreach ($item in Get-ChildItem -LiteralPath $SpotifyDir -Force) {
      if ($item.Name -eq 'prefs' -or $item.Name -eq 'Users') { continue }
      Remove-Item -LiteralPath $item.FullName -Recurse -Force
    }
    Install-Spotify
    Start-Sleep -Seconds 8   # the fresh copy starts once and records its own version
    Stop-Spotify
  }

  function Test-System {
    Say 'Checking the system'
    if ($PSVersionTable.PSVersion -lt [version]'5.1') { throw 'PowerShell 5.1 or newer is required (Windows 10 and 11 have it).' }
    [void](Get-Arch)
    $me = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($me)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      # Spicetify refuses to run as administrator unless told so.
      Info "NOTE: running as administrator. Installing for the Windows user '$($me.Name)'."
      Set-Variable -Name SpicetifyFlags -Value @('--bypass-admin') -Scope 1
    }
  }

  function Test-Spotify {
    Remove-StoreSpotify
    if (-not (Test-Path -LiteralPath $SpotifyExe)) { Install-Spotify } else { Repair-ModifiedSpotify }
    if (-not (Test-PrefsReady)) {
      Info 'Spotify has not been opened yet: opening it once'
      Start-Process -FilePath $SpotifyExe
      if (-not (Wait-PrefsReady 90)) { throw 'open Spotify, log in, close it, then run the installer again.' }
    }
    $raw = (Get-Item -LiteralPath $SpotifyExe).VersionInfo.FileVersion
    if ("$raw" -notmatch '(\d+)[.,]\s*(\d+)[.,]\s*(\d+)') {
      Info "WARNING: cannot read the Spotify version ('$raw'). Continuing."
      return
    }
    $installed = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
    $newest = [version]$V['SPOTIFY_MAX']
    if ($installed -le $newest) {
      Info "Spotify $raw (supported)"
    } elseif ($Force) {
      Info "WARNING: Spotify $raw is newer than the tested $newest. Trying anyway (-Force)."
    } else {
      throw "Spotify $raw is newer than the newest version this installer supports ($newest). Spotify was not changed. Support usually follows within a week: get the newest spotify-ai and run it again."
    }
  }

  function Block-Updates {
    Say 'Blocking Spotify auto-updates'
    try {
      if ((Test-Path -LiteralPath $UpdateBlock -PathType Leaf) -and (Get-Item -LiteralPath $UpdateBlock -Force).IsReadOnly) {
        Info 'already blocked'
        return
      }
      $parent = Split-Path $UpdateBlock -Parent
      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
      if (Test-Path -LiteralPath $UpdateBlock) { Remove-Item -LiteralPath $UpdateBlock -Recurse -Force }
      # The updater downloads into a folder with this name. A locked file in its place stops it.
      [IO.File]::WriteAllText($UpdateBlock, 'Created by spotify-ai to block Spotify auto-updates. The uninstaller removes it.')
      $acl = Get-Acl -LiteralPath $UpdateBlock
      $rule = New-Object Security.AccessControl.FileSystemAccessRule(
        [Security.Principal.WindowsIdentity]::GetCurrent().User, 'Write, Delete', 'Deny')
      $acl.AddAccessRule($rule)
      Set-ItemProperty -LiteralPath $UpdateBlock -Name IsReadOnly -Value $true
      Set-Acl -LiteralPath $UpdateBlock -AclObject $acl
      Info 'blocked (the uninstaller undoes this)'
    } catch {
      Info "WARNING: could not block updates ($($_.Exception.Message))."
      Info 'Everything else still works; after a Spotify update just run the installer again.'
    }
  }

  function Unblock-Updates {
    if (-not (Test-Path -LiteralPath $UpdateBlock -PathType Leaf)) { return }
    try {
      $acl = Get-Acl -LiteralPath $UpdateBlock
      foreach ($rule in @($acl.Access)) {
        if ($rule.AccessControlType -eq 'Deny' -and -not $rule.IsInherited) { [void]$acl.RemoveAccessRule($rule) }
      }
      Set-Acl -LiteralPath $UpdateBlock -AclObject $acl
      Set-ItemProperty -LiteralPath $UpdateBlock -Name IsReadOnly -Value $false
      Remove-Item -LiteralPath $UpdateBlock -Force
      Info 'updates allowed again'
    } catch {
      Info "WARNING: could not remove $UpdateBlock ($($_.Exception.Message)). Delete it by hand to allow updates."
    }
  }

  function Install-Spicetify {
    $wanted = $V['SPICETIFY_CLI']
    Say "Spicetify $wanted"
    if ((Get-SpicetifyVersion) -eq $wanted) { Info 'already installed'; return }
    $fresh = -not ((Test-Path -LiteralPath $SpicetifyHome) -or (Test-Path -LiteralPath $ConfigDir))
    $arch = Get-Arch
    $zip = Join-Path $Work 'spicetify.zip'
    Get-Download "https://github.com/spicetify/cli/releases/download/v$wanted/spicetify-$wanted-windows-$arch.zip" $zip
    Test-Sha256 $zip $V["SPICETIFY_CLI_SHA256_WINDOWS_$($arch.ToUpper())"]
    New-Item -ItemType Directory -Path $SpicetifyHome -Force | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $SpicetifyHome -Force
    if ($fresh) { [IO.File]::WriteAllText($OursMarker, '') }
    Info "installed into $SpicetifyHome"
  }

  function Install-Adblockify {
    $commit = $V['ADBLOCKIFY_COMMIT']
    $sha = $V['ADBLOCKIFY_SHA256']
    Say "adblockify ($($commit.Substring(0, 7)))"
    $target = Join-Path $ConfigDir "Extensions\$Extension"
    $marker = "adblockify $commit sha256:$sha wrapper:2"
    if ((Test-Path -LiteralPath $target) -and (Select-String -LiteralPath $target -SimpleMatch -Pattern $marker -Quiet)) {
      Info 'already installed'
      return
    }
    $tmp = Join-Path $Work 'adblock.js'
    Get-Download "https://raw.githubusercontent.com/rxri/spicetify-extensions/$commit/adblock/adblock.js" $tmp
    Test-Sha256 $tmp $sha
    # The verified, unchanged file is wrapped in a check, so ad blocking can be
    # switched off in AI Playlists -> Settings (takes effect when Spotify restarts).
    # The original goes into its own function, so that its leading "use strict"
    # is still the first statement of a function body.
    $head = @(
      "// $marker",
      '// adblockify by rxri (MIT): https://github.com/rxri/spicetify-extensions',
      '(function () {',
      '  try { if (localStorage.getItem("spotify-ai:adblock") === "off") return; } catch (e) {}',
      '  window.__spotifyAiAdblock = true;',
      '  (function () {'
    ) -join "`n"
    $original = [IO.File]::ReadAllText($tmp, $Utf8)
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($target, $head + "`n" + $original + "`n  })();`n})();`n", $Utf8)
    Info 'installed'
  }

  function Install-Agent {
    Say 'AI Playlists app'
    $source = Join-Path $Work $AgentApp
    New-Item -ItemType Directory -Path $source -Force | Out-Null
    $files = @('index.js', 'manifest.json')
    foreach ($file in $files) { Get-RepoFile "agent/release/$AgentApp/$file" (Join-Path $source $file) }
    $target = Join-Path $ConfigDir "CustomApps\$AgentApp"
    $same = $true
    foreach ($file in $files) {
      $there = Join-Path $target $file
      if (-not (Test-Path -LiteralPath $there)) { $same = $false; break }
      if ((Get-FileHash -LiteralPath $there).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source $file)).Hash) { $same = $false; break }
    }
    if ($same) { Info 'already installed'; return }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $target $file) }
    Info 'installed'
  }

  function Read-Options {
    $options = @{ ADBLOCK = 'on'; BLOCK_REPORTS = 'on' }
    if (Test-Path -LiteralPath $OptionsFile) {
      foreach ($line in Get-Content -LiteralPath $OptionsFile) {
        if ($line -match '^(ADBLOCK|BLOCK_REPORTS)=(on|off)$') { $options[$Matches[1]] = $Matches[2] }
      }
    }
    return $options
  }

  function Save-Options($options) {
    New-Item -ItemType Directory -Path (Split-Path $OptionsFile -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($OptionsFile, "ADBLOCK=$($options.ADBLOCK)`nBLOCK_REPORTS=$($options.BLOCK_REPORTS)`n")
  }

  function Get-IniLine($ini, $key) {
    $line = Get-Content -LiteralPath $ini | Where-Object { $_ -match "^$key\b" } | Select-Object -First 1
    return "$line"
  }

  function Set-Configuration($options) {
    Say 'Configuring Spicetify'
    [void](Invoke-Spicetify config)                       # creates the config on first run
    $ini = Join-Path $ConfigDir 'config-xpui.ini'
    if (-not (Test-Path -LiteralPath $ini)) { throw "Spicetify did not create its config ($ini)." }
    # No themes, no recolouring: we only need the platform. Keeps idle cost at zero.
    Set-SpicetifyConfig inject_css 0 replace_colors 0
    # We ship pinned versions, so Spicetify's own update check would only add a request at startup.
    Set-SpicetifyConfig check_spicetify_update 0
    $hasExtension = (Get-IniLine $ini 'extensions').Contains($Extension)
    if ($options.ADBLOCK -eq 'on' -and -not $hasExtension) {
      Set-SpicetifyConfig extensions $Extension
    } elseif ($options.ADBLOCK -eq 'off' -and $hasExtension) {
      Set-SpicetifyConfig extensions "$Extension-"
    }
    $reports = if ($options.BLOCK_REPORTS -eq 'off') { '0' } else { '1' }
    Set-SpicetifyConfig disable_sentry $reports disable_ui_logging $reports
    Info "ad blocking: $($options.ADBLOCK); crash reports and interface logs to Spotify blocked: $($options.BLOCK_REPORTS)"
    if ((Get-IniLine $ini 'custom_apps') -notmatch "\b$AgentApp\b") {
      Set-SpicetifyConfig custom_apps $AgentApp
    }
    Info 'ok'
  }

  function Invoke-Apply($options) {
    Say 'Applying to Spotify'
    Stop-Spotify
    $xpui = Join-Path $SpotifyDir 'Apps\xpui'
    # Start from Spotify's own files every time: this is what makes a re-run a repair.
    if (Test-Path -LiteralPath $xpui -PathType Container) {
      if (-not (Invoke-Spicetify restore)) {
        throw 'Spotify files are modified but Spicetify has no backup. Reinstall Spotify from https://www.spotify.com/download and run this again.'
      }
    }
    [void](Invoke-Spicetify clear)
    if (-not (Invoke-Spicetify backup apply)) { throw 'Spicetify could not patch this Spotify version.' }
    $applied = Test-Path -LiteralPath (Join-Path $xpui "extensions\$Extension")
    if ($options.ADBLOCK -eq 'on' -and -not $applied) { throw 'the ad-blocking extension was not applied.' }
    if ($options.ADBLOCK -eq 'off' -and $applied) { throw 'the ad-blocking extension is still applied.' }
    if (-not (Test-Path -Path (Join-Path $xpui "spicetify-routes-$AgentApp*"))) { throw 'the AI Playlists app was not applied.' }
    Info 'done'
  }

  function Invoke-Uninstall {
    Say 'Uninstalling'
    Stop-Spotify
    $hasSpicetify = Test-Path -LiteralPath $Spicetify
    if ($hasSpicetify -and (Test-Path -LiteralPath (Join-Path $SpotifyDir 'Apps\xpui') -PathType Container)) {
      if (-not (Invoke-Spicetify restore)) {
        # Nothing is deleted: the backup Spicetify holds may still be needed.
        throw 'could not restore the Spotify files. Nothing was removed. To reset Spotify, reinstall it from https://www.spotify.com/download and run this again.'
      }
      Info 'Spotify files restored'
    }
    $ours = Test-Path -LiteralPath $OursMarker
    if ($ours) {
      Remove-Item -LiteralPath $SpicetifyHome -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $ConfigDir -Recurse -Force -ErrorAction SilentlyContinue
      Info 'Spicetify removed'
    } elseif ($hasSpicetify) {
      # Spicetify was here before us: remove only what this installer added.
      Remove-Item -LiteralPath (Join-Path $ConfigDir "Extensions\$Extension") -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path $ConfigDir "CustomApps\$AgentApp") -Recurse -Force -ErrorAction SilentlyContinue
      [void](Invoke-Spicetify config extensions "$Extension-" custom_apps "$AgentApp-")
      [void](Invoke-Spicetify backup apply)
      Info 'our extension and app removed; your own Spicetify setup was kept'
    }
    Remove-Item -LiteralPath (Split-Path $OptionsFile -Parent) -Recurse -Force -ErrorAction SilentlyContinue
    if ($ours -or -not $hasSpicetify) {
      Unblock-Updates
      Say 'Done. Spotify is back to its original state.'
    } else {
      Say 'Done. Our parts are removed; Spicetify itself and the update block were left as they are.'
    }
    Info 'Note: settings saved inside Spotify (including an API key you entered) are not removed.'
    Info 'To clear them: AI Playlists > Settings before uninstalling, or delete the Spotify local data.'
  }

  # ---- main ----------------------------------------------------------------
  New-Item -ItemType Directory -Path $Work -Force | Out-Null
  try {
    Test-System
    if ($Uninstall) {
      Invoke-Uninstall
      return
    }

    $versionsFile = Join-Path $Work 'versions'
    Get-RepoFile 'versions' $versionsFile
    $V = @{}
    foreach ($line in Get-Content -LiteralPath $versionsFile) {
      if ($line -match '^([A-Z0-9_]+)=(.+)$') { $V[$Matches[1]] = $Matches[2].Trim() }
    }
    foreach ($key in 'SPOTIFY_MAX', 'SPICETIFY_CLI', 'ADBLOCKIFY_COMMIT', 'ADBLOCKIFY_SHA256') {
      if (-not $V[$key]) { throw "the versions file has no $key. Download the repository again." }
    }

    $options = Read-Options
    if ($Adblock) { $options.ADBLOCK = $Adblock }
    if ($BlockReports) { $options.BLOCK_REPORTS = $BlockReports }

    Test-Spotify
    Save-Options $options
    Stop-Spotify
    Block-Updates
    Install-Spicetify
    Install-Adblockify
    Install-Agent
    Set-Configuration $options
    Invoke-Apply $options
    Say 'Done. The AI Playlists button is in the top bar of Spotify, left of Home.'
    if (-not $NoLaunch) {
      Info 'starting Spotify'
      Start-Process -FilePath $SpotifyExe
    }
  } finally {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$spotifyAiFailed = $false
try {
  Install-SpotifyAi -Uninstall ([bool]$Uninstall) -Adblock $Adblock -BlockReports $BlockReports `
    -Force ([bool]$Force) -NoLaunch ([bool]$NoLaunch) -Here "$PSScriptRoot" -CleanSpotify $CleanSpotify
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  $spotifyAiFailed = $true
}
# Only when run as a file: under "irm | iex" an exit would close the user's window.
if ($PSCommandPath) {
  if ($spotifyAiFailed) { exit 1 } else { exit 0 }
}
