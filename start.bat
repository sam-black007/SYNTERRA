@echo off
title SYNTERRA — Agricultural Intelligence Platform
cd /d "%~dp0"
echo ==========================================================
echo SYNTERRA — Agricultural Intelligence Platform
echo Engineering Intelligence for a Growing World
echo ==========================================================

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv
    call .venv\Scripts\pip.exe install -r requirements.txt
)

if not exist ".env" (
    copy .env.example .env
)

echo Starting SYNTERRA Platform Server...
start http://localhost:5000/dashboard
call .venv\Scripts\python.exe run.py
pause
