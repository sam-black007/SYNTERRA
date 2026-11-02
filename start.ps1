# SYNTERRA — One-Click Real-World Launcher (PowerShell)
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "SYNTERRA — Agricultural Intelligence Platform" -ForegroundColor Cyan
Write-Host "Engineering Intelligence for a Growing World" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check virtual environment
if (!(Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
    .\.venv\Scripts\pip.exe install -r requirements.txt
}

# Check .env
if (!(Test-Path ".env")) {
    Write-Host "Creating .env from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
}

Write-Host "Starting SYNTERRA Platform Server on http://localhost:5000..." -ForegroundColor Green
Write-Host "Opening Live Console in browser..." -ForegroundColor Cyan
Start-Process "http://localhost:5000/dashboard"

# Start the Flask + WebSocket server
& ".\.venv\Scripts\python.exe" run.py
