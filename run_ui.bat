@echo off
title Diablo II Save ^& Item Explorer UI
cd /d "%~dp0"

echo ========================================================
echo   Diablo II: Resurrected - Save ^& Item Explorer UI
echo ========================================================
echo.
echo Starting web server and opening browser...
echo Press Ctrl+C in this window to stop the server.
echo.

python web_ui.py %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server exited with an error.
    pause
)
