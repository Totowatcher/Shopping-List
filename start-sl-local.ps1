[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir = Join-Path $RepoRoot ".sl-local"
$BackendPidPath = Join-Path $StateDir "backend.pid"
$FrontendPidPath = Join-Path $StateDir "frontend.pid"
$BackendLogPath = Join-Path $StateDir "backend.log"
$FrontendLogPath = Join-Path $StateDir "frontend.log"
$BackendErrLogPath = Join-Path $StateDir "backend.err.log"
$FrontendErrLogPath = Join-Path $StateDir "frontend.err.log"

function Get-ProcessByPidFile {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    $txt = (Get-Content -LiteralPath $Path -Raw).Trim()
    if (-not $txt) {
        return $null
    }
    $procId = 0
    if (-not [int]::TryParse($txt, [ref] $procId)) {
        return $null
    }
    return Get-Process -Id $procId -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
    New-Item -ItemType Directory -Path $StateDir | Out-Null
}

function Assert-PortFree {
    param(
        [int] $Port,
        [string] $Label
    )
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        throw "$Label cannot start: port $Port is already in use by PID $($conn.OwningProcess). Run .\stop-sl-local.ps1 first."
    }
}

function Wait-ForListener {
    param(
        [int] $Port,
        [int] $TimeoutSeconds = 12
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Remove-StalePidFile {
    param([string] $PidPath)
    $proc = Get-ProcessByPidFile -Path $PidPath
    if (-not $proc -and (Test-Path -LiteralPath $PidPath -PathType Leaf)) {
        Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
    }
}

function Start-Backend {
    Assert-PortFree -Port 8004 -Label "Backend"
    $backendPy = Join-Path $RepoRoot "web\backend\.venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $backendPy -PathType Leaf)) {
        throw "Backend venv python not found: $backendPy (create it: cd web\backend; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt)"
    }
    $backendWd = Join-Path $RepoRoot "web\backend"
    Remove-Item -LiteralPath $BackendLogPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $BackendErrLogPath -Force -ErrorAction SilentlyContinue
    Write-Host "Starting backend..." -ForegroundColor Cyan
    $backendProc = Start-Process -FilePath $backendPy -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8004") -WorkingDirectory $backendWd -RedirectStandardOutput $BackendLogPath -RedirectStandardError $BackendErrLogPath -PassThru
    Set-Content -LiteralPath $BackendPidPath -Value $backendProc.Id -NoNewline
    if (-not (Wait-ForListener -Port 8004)) {
        Write-Host "Backend failed to listen on port 8004. See log: $BackendLogPath" -ForegroundColor Red
        throw "Backend failed to start."
    }
    Write-Host "Backend started (PID $($backendProc.Id))." -ForegroundColor Green
}

function Start-Frontend {
    Assert-PortFree -Port 5175 -Label "Frontend"
    $frontendWd = Join-Path $RepoRoot "web\frontend"
    $npmCmd = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        throw "npm.cmd not found on PATH. Install Node.js and reopen PowerShell."
    }
    $pkgJsonPath = Join-Path $frontendWd "package.json"
    if (-not (Test-Path -LiteralPath $pkgJsonPath -PathType Leaf)) {
        throw "Frontend package.json not found: $pkgJsonPath"
    }
    Remove-Item -LiteralPath $FrontendLogPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $FrontendErrLogPath -Force -ErrorAction SilentlyContinue
    Write-Host "Starting frontend..." -ForegroundColor Cyan
    $frontendProc = Start-Process -FilePath $npmCmd.Source -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "5175", "--strictPort") -WorkingDirectory $frontendWd -RedirectStandardOutput $FrontendLogPath -RedirectStandardError $FrontendErrLogPath -PassThru
    Set-Content -LiteralPath $FrontendPidPath -Value $frontendProc.Id -NoNewline
    if (-not (Wait-ForListener -Port 5175)) {
        Write-Host "Frontend failed to listen on port 5175. See log: $FrontendLogPath" -ForegroundColor Red
        throw "Frontend failed to start."
    }
    Write-Host "Frontend started (PID $($frontendProc.Id))." -ForegroundColor Green
}

Remove-StalePidFile -PidPath $BackendPidPath
Remove-StalePidFile -PidPath $FrontendPidPath

$backendExisting = Get-ProcessByPidFile -Path $BackendPidPath
if ($backendExisting) {
    Write-Host "Backend already running (PID $($backendExisting.Id))." -ForegroundColor Yellow
}
else {
    Start-Backend
}

$frontendExisting = Get-ProcessByPidFile -Path $FrontendPidPath
if ($frontendExisting) {
    Write-Host "Frontend already running (PID $($frontendExisting.Id))." -ForegroundColor Yellow
}
else {
    Start-Frontend
}

Write-Host "Local Shopping-List services are ready." -ForegroundColor Green
Write-Host "  Frontend: http://127.0.0.1:5175/shop/" -ForegroundColor Green
Write-Host "  Backend:  http://127.0.0.1:8004/api/health" -ForegroundColor Green
