@echo off
rem Double-click this file. It needs no administrator rights.
rem With install.ps1 next to it, that file is used; alone, the newest one is downloaded from GitHub.
setlocal
title Spotify AI - uninstall
if exist "%~dp0install.ps1" goto local
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/ganfay/spotify-ai/main/install.ps1'))) -Uninstall"
goto done
:local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall %*
:done
echo.
pause
