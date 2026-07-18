[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir = Join-Path $RepoRoot ".sl-local"
$BackendPidPath = Join-Path $StateDir "backend.pid"
$FrontendPidPath = Join-Path $StateDir "frontend.pid"

function Stop-FromPidFile {
    param(
        [string] $Label,
        [string] $PidPath
    )
    if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) {
        Write-Host "$Label is not tracked as running." -ForegroundColor Yellow
        return
    }

    $txt = (Get-Content -LiteralPath $PidPath -Raw).Trim()
    $procId = 0
    if (-not [int]::TryParse($txt, [ref] $procId)) {
        Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
        Write-Host "$Label pid file was invalid; cleaned up." -ForegroundColor Yellow
        return
    }

    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) {
        Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
        Write-Host "$Label process already stopped." -ForegroundColor Yellow
        return
    }

    Write-Host "Stopping $Label (PID $procId)..." -ForegroundColor Cyan
    try {
        # Kill the whole process tree (important for uvicorn --reload child workers).
        & taskkill /PID $procId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Stop-Process -Id $procId -Force -ErrorAction Stop
        }
    }
    catch {
        Write-Host "Could not stop $Label PID ${procId}: $($_.Exception.Message)" -ForegroundColor Red
        throw
    }
    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
    Write-Host "$Label stopped." -ForegroundColor Green
}

function Stop-ListenerOnPort {
    param(
        [string] $Label,
        [int] $Port
    )
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        return
    }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        Write-Host "Stopping $Label listener on port $Port (PID $p)..." -ForegroundColor Cyan
        & taskkill /PID $p /T /F | Out-Null
    }
}

Stop-FromPidFile -Label "Frontend" -PidPath $FrontendPidPath
Stop-FromPidFile -Label "Backend" -PidPath $BackendPidPath
Stop-ListenerOnPort -Label "Frontend" -Port 5175
Stop-ListenerOnPort -Label "Backend" -Port 8004

Write-Host "Local Shopping-List services are stopped." -ForegroundColor Green
