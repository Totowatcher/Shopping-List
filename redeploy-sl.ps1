<#
.SYNOPSIS
    Redeploy Shopping-List to the steve MacBook server (shared Docker stack).

.DESCRIPTION
    Matches the Docker workflow in Travel-Research\redeploy-tr.ps1:
      - git pull on the server (Shopping-List + RSGL-Points, which hosts compose)
      - build the Shopping-List frontend on the server (Docker bind-mounts dist/)
      - docker compose up -d --build shop-api
      - health-check via Caddy on :80

    Also stops/restarts local Shopping-List dev services if they were running.

    Compose lives in the sibling RSGL-Points repo:
      /home/steve/RSGL-Points/deploy/docker

.PARAMETER SkipNpmCi
    Skip "npm ci" and run "npm run build" only on the server.

.PARAMETER SkipBuild
    Skip the frontend build; only git pull + docker compose up.

.EXAMPLE
    .\redeploy-sl.ps1

.EXAMPLE
    .\redeploy-sl.ps1 -SkipNpmCi
#>
[CmdletBinding()]
param(
    [switch] $SkipNpmCi,
    [switch] $SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SlRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Server = "steve@100.117.145.116"
$ComposeDir = "/home/steve/RSGL-Points/deploy/docker"

$StateDir = Join-Path $SlRoot ".sl-local"
$BackendPidPath = Join-Path $StateDir "backend.pid"
$FrontendPidPath = Join-Path $StateDir "frontend.pid"
$stopScript = Join-Path $SlRoot "stop-sl-local.ps1"
$startScript = Join-Path $SlRoot "start-sl-local.ps1"

function Is-TrackedProcessRunning {
    param([string] $PidPath)
    if (-not (Test-Path -LiteralPath $PidPath -PathType Leaf)) {
        return $false
    }
    $txt = (Get-Content -LiteralPath $PidPath -Raw).Trim()
    $procId = 0
    if (-not [int]::TryParse($txt, [ref] $procId)) {
        return $false
    }
    return [bool](Get-Process -Id $procId -ErrorAction SilentlyContinue)
}

function Invoke-Ssh {
    param([string] $Cmd)
    & ssh $Server $Cmd
    if ($LASTEXITCODE -ne 0) { throw "ssh failed: $Cmd" }
}

function Wait-HealthCheck {
    param(
        [string] $Url,
        [string] $Label,
        [int] $Retries = 15,
        [int] $DelaySeconds = 2
    )
    for ($i = 1; $i -le $Retries; $i++) {
        & ssh $Server "curl -sS --fail '$Url' >/dev/null"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "$Label OK" -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds $DelaySeconds
    }
    throw "$Label health check failed after $($Retries * $DelaySeconds)s"
}

$wasRunning = (Is-TrackedProcessRunning -PidPath $BackendPidPath) -or (Is-TrackedProcessRunning -PidPath $FrontendPidPath)
if ($wasRunning) {
    Write-Host "Local services are running; stopping before redeploy..." -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to stop local services before redeploy (exit code $LASTEXITCODE)."
    }
}
else {
    Write-Host "Local services are not running; proceeding to redeploy..." -ForegroundColor Yellow
}

Write-Host "== Git pull ==" -ForegroundColor Cyan
Invoke-Ssh "cd /home/steve/Shopping-List && git pull"
# Compose stack lives under RSGL-Points; keep it current even for Shopping-List-only deploys.
Invoke-Ssh "cd /home/steve/RSGL-Points && git pull"

if (-not $SkipBuild) {
    # Docker bind-mounts dist/ from the server repo, so the frontend must be built there.
    Write-Host "== Build Shopping-List frontend (on server) ==" -ForegroundColor Cyan
    if ($SkipNpmCi) {
        Invoke-Ssh "cd /home/steve/Shopping-List/web/frontend && npm run build"
    }
    else {
        Invoke-Ssh "cd /home/steve/Shopping-List/web/frontend && npm ci && npm run build"
    }
}

Write-Host "== Docker compose up ==" -ForegroundColor Cyan
Invoke-Ssh "cd $ComposeDir && docker compose up -d --build shop-api"

Write-Host "== Health checks ==" -ForegroundColor Cyan
Wait-HealthCheck -Url "http://127.0.0.1/shop/api/health" -Label "Shopping-List"

if ($wasRunning) {
    Write-Host "Redeploy succeeded; restarting local services..." -ForegroundColor Cyan
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript
    if ($LASTEXITCODE -ne 0) {
        throw "Redeploy succeeded, but failed to restart local services (exit code $LASTEXITCODE)."
    }
}

Write-Host "Redeploy complete." -ForegroundColor Green
Write-Host "Public: https://steve.tail09ce3d.ts.net/shop/"
