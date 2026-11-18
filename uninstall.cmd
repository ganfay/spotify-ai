@echo off
rem Double-click this file. It needs no administrator rights.
rem With install.ps1 next to it, that file is used; alone, the newest one is downloaded from GitHub.
setlocal
title Spotify AI - uninstall
if exist "%~dp0install.ps1" goto local
set SPOTIFY_AI_UNINSTALL=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; iex (irm 'https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1')"
goto done
:local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall %*
:done
echo.
pause
