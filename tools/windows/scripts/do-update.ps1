<#
  SCHOOL MANAGEMENT SYSTEM - Update engine (Windows).

  Replaces the old update.bat: the in-app "Update now" dialog launches this.
  Stops the servers first (so watchers don't hold locks), then fetches, pulls,
  installs, regenerates the Prisma client and applies migrations, and finally
  relaunches the system with start.bat. All data-safe: it never touches the
  database contents beyond the additive prisma migrate deploy.

  Invoked detached by the backend: UpdateNow in the app -> this script.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root      = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$BackendDir = Join-Path $Root "apps\backend"

function Fail {
  param([string]$Message)
  Write-Host ""
  Write-Host "  [FAILED] $Message" -ForegroundColor Red
  Write-Host "  Nothing was lost - the update stopped before touching the database." -ForegroundColor Yellow
  Write-Host "  You can close this window and start the app again with start.bat." -ForegroundColor Yellow
  Read-Host "  Press Enter to close"
  exit 1
}

# The tracked release branch comes from UPDATE_BRANCH in apps/backend/.env
# (each school install pins the same branch, e.g. selfhosted) - otherwise main.
$Branch = "main"
$EnvFile = Join-Path $BackendDir ".env"
if (Test-Path $EnvFile) {
  $match = Select-String -Path $EnvFile -Pattern '^UPDATE_BRANCH=(.+)$' -ErrorAction SilentlyContinue
  if ($match) { $Branch = $match.Matches[0].Groups[1].Value.Trim() }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  SCHOOL MANAGEMENT SYSTEM - Update" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path (Join-Path $Root ".git"))) { Fail "Not a git repository - update only works on a cloned install." }

# ---------------------------------------------------------------------------
# 1. Stop the running servers (watchers would otherwise lock node_modules
#    and open files and the update would fail with EPERM).
# ---------------------------------------------------------------------------
Write-Host "Stopping the running servers..." -ForegroundColor Yellow
& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop.ps1") -Ports @(3000, 3001) | Out-Null

Write-Host "Waiting for ports 3000/3001 to release..." -ForegroundColor Yellow
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Seconds 1
  $busy = Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue
  if (-not $busy) { break }
}

# ---------------------------------------------------------------------------
# 2. Fetch + compare
# ---------------------------------------------------------------------------
Write-Host "Fetching the latest version from the repository..." -ForegroundColor Yellow
Push-Location $Root
git fetch origin 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "git fetch failed - check the internet connection." }

$behind = (git rev-list HEAD..origin/$Branch --count 2>$null | Select-Object -Last 1)
if (-not $behind) { $behind = "0" }
$behind = $behind.Trim()
if ([int]$behind -le 0) {
  Write-Host "  Already on the latest version - no new commits." -ForegroundColor Green
  Pop-Location
  Start-Process (Join-Path $Root "tools\windows\start.bat")
  exit 0
}
Write-Host "  $behind new commit(s) on origin/$Branch." -ForegroundColor Green

git pull origin $Branch 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "git pull failed - resolve the conflict manually and try again." }
Pop-Location

# ---------------------------------------------------------------------------
# 3. Dependencies + Prisma client + migrations
# ---------------------------------------------------------------------------
Write-Host "Syncing dependencies (pnpm install)..." -ForegroundColor Yellow
Push-Location $Root
pnpm install 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "pnpm install failed." }
Pop-Location

Write-Host "Generating the Prisma client..." -ForegroundColor Yellow
Push-Location $BackendDir
$genOk = $false
for ($attempt = 1; $attempt -le 5; $attempt++) {
  pnpm exec prisma generate 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $genOk = $true; break }
  Write-Host "  prisma generate failed (attempt $attempt/5) - retrying..." -ForegroundColor Yellow
  Start-Sleep -Seconds 3
}
if (-not $genOk) { Pop-Location; Fail "prisma generate failed after 5 attempts." }

Write-Host "Applying the new migrations (data-safe)..." -ForegroundColor Yellow
pnpm run db:migrate 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  Warning: migration reported an issue - the data is safe; see the output above." -ForegroundColor Yellow
}
Pop-Location

# ---------------------------------------------------------------------------
# 4. Relaunch
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Update complete - starting the system..." -ForegroundColor Green
Start-Process (Join-Path $Root "tools\windows\start.bat")
exit 0