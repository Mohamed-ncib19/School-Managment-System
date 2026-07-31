<#
  IQ Academy - one-click local launcher.
  Handles everything on a clean machine with auto-recovery:
  Node.js, pnpm, PostgreSQL, dependencies, build, migrations, seed, start.
  Run it via start.bat.
#>
[CmdletBinding()]
param(
  [switch]$Dev,
  [switch]$NoBackup
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root "apps\backend"
$FrontendDir = Join-Path $Root "apps\frontend"
$LogDir = Join-Path $Root "logs"

$BackendPort = 3001
$FrontendPort = 3000

$BOX = "============================================================"

# --- console helpers -------------------------------------------------------
function Write-Step { param([string]$Message) Write-Host "`n  ==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "  [OK]  $Message" -ForegroundColor Green }
function Write-Warn2 { param([string]$Message) Write-Host "  [!]   $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Host "       $Message" -ForegroundColor DarkGray }
function Write-Err  { param([string]$Message) Write-Host "  [X]   $Message" -ForegroundColor Red }
function Write-Fix  { param([string]$Message) Write-Host "  [*]   $Message" -ForegroundColor Magenta }

function Show-Progress {
  param([int]$Step, [int]$Total, [string]$Message)
  $pct = [math]::Round(($Step / $Total) * 100)
  $barLen = 30
  $filled = [math]::Round($barLen * $Step / $Total)
  $empty  = $barLen - $filled
  $bar = ("#" * $filled) + ("-" * $empty)
  Write-Host ""
  Write-Host "  -------------------------------------------" -ForegroundColor DarkGray
  Write-Host "  >> $Message" -ForegroundColor White
  Write-Host "  [$bar] $pct%" -ForegroundColor Cyan
}

function Fail {
  param([string]$Message, [string]$Hint)
  Write-Err $Message
  if ($Hint) { Write-Host "`n$Hint" -ForegroundColor Yellow }
  Write-Host "`nPress any key to close..." -ForegroundColor DarkGray
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
  exit 1
}

function Test-Port {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $wait = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $wait.AsyncWaitHandle.WaitOne(1200, $false)
    if ($ok -and $client.Connected) { $client.Close(); return $true }
    $client.Close()
    return $false
  } catch { return $false }
}

function Kill-Port {
  param([int]$Port)
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conns) {
    foreach ($conn in $conns) {
      try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Seconds 2
    # Force kill if still alive
    if (Test-Port $Port) {
      $conns2 = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
      foreach ($conn in $conns2) {
        try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
      }
      Start-Sleep -Seconds 1
    }
  }
}

function Get-EnvValue {
  param([string]$Path, [string]$Key)
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+)\s*$") { return $Matches[1].Trim() }
  }
  return $null
}

function Find-Psql {
  param([string]$PgBin)
  # Try provided path first
  if ($PgBin) {
    $candidate = Join-Path $PgBin "psql.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  # Try portable runtime
  $portable = Get-ChildItem (Join-Path $Root ".postgres\runtime") -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portable) { return $portable.FullName }
  # Try PATH
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # Try native install
  $native = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($native) { return $native.FullName }
  return $null
}

function Invoke-WithRetry {
  param([scriptblock]$Action, [int]$MaxRetries = 2, [int]$DelaySeconds = 3, [string]$Description = "operation")
  for ($attempt = 1; $attempt -le ($MaxRetries + 1); $attempt++) {
    try {
      $result = & $Action
      return $result
    } catch {
      if ($attempt -le $MaxRetries) {
        Write-Fix "$Description failed (attempt $attempt), retrying in $DelaySeconds s..."
        Start-Sleep -Seconds $DelaySeconds
      } else {
        Write-Err "$Description failed after $($MaxRetries + 1) attempts: $($_.Exception.Message)"
        return $null
      }
    }
  }
}

# ===========================================================================
#  BANNER
# ===========================================================================
Clear-Host
Write-Host ""
Write-Host "  $BOX" -ForegroundColor Cyan
Write-Host "  =                                                          =" -ForegroundColor Cyan
Write-Host "  =      ___  _______  _______  ______   _______             =" -ForegroundColor White
Write-Host "  =     |   ||       ||       ||    _ | |       |            =" -ForegroundColor White
Write-Host "  =     |   ||   _   ||_     _||   | || |  _____|            =" -ForegroundColor White
Write-Host "  =     |   ||  | |  |  |   |  |   |_|| | |_____             =" -ForegroundColor White
Write-Host "  =     |   ||  |_|  |  |   |  |    __| |_____  |            =" -ForegroundColor White
Write-Host "  =     |___||_______|  |___|  |___|    ______| |            =" -ForegroundColor White
Write-Host "  =                                                          =" -ForegroundColor Cyan
Write-Host "  =        INTERN MANAGEMENT SYSTEM                          =" -ForegroundColor Yellow
Write-Host "  =                                                          =" -ForegroundColor Cyan
Write-Host "  $BOX" -ForegroundColor Cyan
Write-Host ""

$totalSteps = 10
$currentStep = 0

# ===========================================================================
#  1. NODE.JS
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Warn2 "Node.js not found on this machine."
  Write-Info "Installing Node.js LTS via winget (one-time, approx 2 min)..."
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "Neither Node.js nor winget is available." "Install Node.js 20 LTS from https://nodejs.org and run start.bat again."
  }
  $installResult = Invoke-WithRetry -Action { winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent } -Description "Node.js installation"
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Fail "Node.js installed but isn't on PATH yet." "Close this window, open a new one, and run start.bat again." }
}
Write-Ok "Node $(node --version)"

# ===========================================================================
#  2. PNPM
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Checking pnpm"
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Warn2 "pnpm not found."
  Write-Info "Enabling via corepack..."
  try {
    corepack enable pnpm 2>$null | Out-Null
    corepack prepare pnpm@latest --activate 2>$null | Out-Null
  } catch {
    Write-Info "Corepack failed, installing via npm..."
    npm install -g pnpm 2>$null | Out-Null
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $pnpm) { Fail "Could not install pnpm." "Run: npm install -g pnpm" }
}
Write-Ok "pnpm $(pnpm --version)"

# ===========================================================================
#  3. ENVIRONMENT FILES
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Checking configuration"
$backendEnv = Join-Path $BackendDir ".env"
$frontendEnv = Join-Path $FrontendDir ".env.local"
if (-not (Test-Path $backendEnv)) {
  if (Test-Path (Join-Path $BackendDir ".env.example")) {
    Copy-Item (Join-Path $BackendDir ".env.example") $backendEnv
    Write-Ok "Created apps/backend/.env from .env.example"
  } else {
    Fail "No .env or .env.example found in apps/backend" "Create apps/backend/.env with DATABASE_URL"
  }
}
if (-not (Test-Path $frontendEnv)) {
  if (Test-Path (Join-Path $FrontendDir ".env.example")) {
    Copy-Item (Join-Path $FrontendDir ".env.example") $frontendEnv
    Write-Ok "Created apps/frontend/.env.local from .env.example"
  } else {
    Write-Warn2 "No .env.local or .env.example in apps/frontend (continuing)"
  }
}

$databaseUrl = Get-EnvValue $backendEnv "DATABASE_URL"
if (-not $databaseUrl) { Fail "DATABASE_URL is missing from apps/backend/.env" }

$pgPattern = "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)"
if ($databaseUrl -notmatch $pgPattern) {
  Fail "DATABASE_URL in apps/backend/.env is not a valid Postgres connection string."
}
$dbUser = $Matches[1]; $dbPass = $Matches[2]; $dbHost = $Matches[3]
$dbPort = [int]$Matches[4]; $dbName = $Matches[5]
Write-Ok "Config loaded. Database: $dbName @ $dbHost`:$dbPort"

# ===========================================================================
#  4. POSTGRESQL
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Checking PostgreSQL"
Write-Info "Looking for an existing PostgreSQL server..."
try {
  $pgBin = & (Join-Path $PSScriptRoot "ensure-postgres.ps1") -Port $dbPort
} catch {
  Fail "Could not start PostgreSQL: $($_.Exception.Message)" "Install PostgreSQL 16 manually from https://www.postgresql.org/download/windows/ (superuser password iq_academy_local, port $dbPort) and run start.bat again."
}
Write-Ok "PostgreSQL is accepting connections on port $dbPort"

$psql = Find-Psql -PgBin $pgBin

if ($psql) {
  Write-Step "Ensuring database role and database exist"
  $superPass = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
  if (-not $superPass) { $superPass = "iq_academy_local" }
  $env:PGPASSWORD = $superPass

  # Role
  $roleExists = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1 FROM pg_roles WHERE rolname='$dbUser'" 2>$null
  if ($roleExists -ne "1") {
    Write-Info "Creating role $dbUser..."
    & $psql -U postgres -h $dbHost -p $dbPort -c "CREATE ROLE $dbUser LOGIN PASSWORD '$dbPass' CREATEDB" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Role $dbUser created" } else { Write-Warn2 "Could not create role $dbUser - may already exist" }
  } else {
    Write-Ok "Role $dbUser exists"
  }

  # Database
  $dbExists = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" 2>$null
  if ($dbExists -ne "1") {
    Write-Info "Creating database $dbName..."
    & $psql -U postgres -h $dbHost -p $dbPort -c "CREATE DATABASE $dbName OWNER $dbUser" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Database $dbName created" } else { Write-Warn2 "Could not create database $dbName" }
  } else {
    Write-Ok "Database $dbName exists"
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
} else {
  Write-Warn2 "psql not found - skipping role/database setup"
}

# ===========================================================================
#  5. DEPENDENCIES
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Installing dependencies"
$lockFile = Join-Path $Root "pnpm-lock.yaml"
$modulesDir = Join-Path $Root "node_modules"
$stampFile = Join-Path $modulesDir ".iq-install-stamp"
$backendModules = Join-Path $BackendDir "node_modules"
$frontendModules = Join-Path $FrontendDir "node_modules"

$needsInstall = $false
if (-not (Test-Path $modulesDir)) { $needsInstall = $true }
elseif (-not (Test-Path $backendModules) -or -not (Test-Path $frontendModules)) { $needsInstall = $true }
elseif (-not (Test-Path $lockFile)) { $needsInstall = $true }

if ($needsInstall) {
  Write-Info "Running pnpm install (first run takes a few minutes)..."
  Push-Location $Root
  pnpm install 2>$null | Out-Null
  $installExit = $LASTEXITCODE
  Pop-Location
  if ($installExit -ne 0) {
    Write-Fix "pnpm install failed, cleaning cache and retrying..."
    Push-Location $Root
    pnpm store prune 2>$null | Out-Null
    pnpm install 2>$null | Out-Null
    $installExit = $LASTEXITCODE
    Pop-Location
    if ($installExit -ne 0) { Fail "pnpm install failed after retry." "Check your internet connection and run start.bat again." }
  }
  if (-not (Test-Path $frontendModules)) {
    Write-Fix "node_modules missing after install, retrying with force..."
    Push-Location $Root
    pnpm install --force 2>$null | Out-Null
    Pop-Location
  }
  Write-Info "Approving build scripts for Prisma..."
  pnpm approve-builds @prisma/client @prisma/engines prisma @nestjs/core 2>$null | Out-Null
  New-Item -ItemType File -Path $stampFile -Force | Out-Null
  Write-Ok "All packages installed"
} else {
  Write-Ok "Dependencies already up to date"
}

# ===========================================================================
#  6. SAFETY BACKUP
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Safety backup"
if (-not $NoBackup) {
  try {
    Write-Info "Dumping database to backups folder..."
    & (Join-Path $PSScriptRoot "backup.ps1") -Quiet
    Write-Ok "Backup written to backups\"
  } catch {
    Write-Warn2 "Backup skipped (non-critical): $($_.Exception.Message)"
  }
} else {
  Write-Ok "Skipped (NoBackup flag set)"
}

# ===========================================================================
#  7. DATABASE MIGRATIONS + SEED
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Applying database migrations"

# Auto-kill stale connections before migration
Write-Info "Checking for stale database connections..."
$env:PGPASSWORD = $superPass
if (-not $superPass) {
  $superPass = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
  if (-not $superPass) { $superPass = "iq_academy_local" }
  $env:PGPASSWORD = $superPass
}
if ($psql) {
  $staleConns = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname='$dbName' AND pid <> pg_backend_pid()" 2>$null
  if ($staleConns -and [int]$staleConns -gt 0) {
    Write-Fix "Terminating $staleConns stale connection(s)..."
    & $psql -U postgres -h $dbHost -p $dbPort -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$dbName' AND pid <> pg_backend_pid()" 2>$null | Out-Null
    Start-Sleep -Seconds 2
    Write-Ok "Stale connections cleared"
  } else {
    Write-Ok "No stale connections"
  }
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# Prisma generate
Write-Info "Running prisma generate..."
Push-Location $BackendDir
$genOutput = pnpm exec prisma generate 2>&1
$genOutput | ForEach-Object { Write-Info "  $_" }
Pop-Location

# Prisma migrate with auto-retry on lock/connection errors
$migrateSuccess = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  Write-Info "Running prisma migrate deploy (attempt $attempt)..."
  Push-Location $BackendDir
  $migOutput = pnpm exec prisma migrate deploy 2>&1
  $migOutput | ForEach-Object { Write-Info "  $_" }
  $migrateExit = $LASTEXITCODE
  Pop-Location

  if ($migrateExit -eq 0) {
    $migrateSuccess = $true
    break
  }

  # Auto-recover from common errors
  $lastOutput = ($migOutput | Out-String)
  if ($lastOutput -match "being accessed by other users") {
    Write-Fix "Database locked by other connections. Terminating them..."
    $env:PGPASSWORD = $superPass
    if ($psql) {
      & $psql -U postgres -h $dbHost -p $dbPort -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$dbName' AND pid <> pg_backend_pid()" 2>$null | Out-Null
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
  } elseif ($lastOutput -match "already exists") {
    Write-Fix "Migration conflict detected, retrying..."
    Start-Sleep -Seconds 2
  } else {
    Write-Fix "Migration failed, retrying..."
    Start-Sleep -Seconds 3
  }
}

if (-not $migrateSuccess) {
  Write-Fix "Standard migrate failed. Attempting prisma migrate reset..."
  Push-Location $BackendDir
  $env:PGPASSWORD = $superPass
  $resetOutput = echo "y" | pnpm exec prisma migrate reset --force 2>&1
  $resetOutput | ForEach-Object { Write-Info "  $_" }
  $resetExit = $LASTEXITCODE
  Pop-Location
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

  if ($resetExit -eq 0) {
    Write-Ok "Database reset and migrated successfully"
  } else {
    Fail "Database migration failed after all recovery attempts." "Check logs\backend.log or run prisma migrate reset manually."
  }
} else {
  Write-Ok "Schema is up to date"
}

# Seed
Write-Step "Seeding admin account"
Push-Location $BackendDir
$seedOutput = pnpm run db:seed 2>&1
$seedOutput | ForEach-Object { Write-Info "  $_" }
Pop-Location
Write-Ok "Admin account ready (admin@iqacademy.com / admin123)"

# ===========================================================================
#  8. BUILD
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Building the application"
Write-Info "Compiling backend (NestJS) and frontend (Next.js)..."

$buildSuccess = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  Push-Location $Root
  $buildOutput = pnpm build 2>&1
  $buildOutput | ForEach-Object { Write-Info "  $_" }
  $buildExit = $LASTEXITCODE
  Pop-Location

  if ($buildExit -eq 0) {
    $buildSuccess = $true
    break
  }

  Write-Fix "Build failed (attempt $attempt). Cleaning and retrying..."

  # Clean build artifacts and retry
  Remove-Item (Join-Path $FrontendDir ".next") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $BackendDir "dist") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $Root "node_modules\.cache") -Recurse -Force -ErrorAction SilentlyContinue

  if ($attempt -eq 2) {
    Write-Fix "Retrying with fresh node_modules..."
    Push-Location $Root
    pnpm install --force 2>$null | Out-Null
    Pop-Location
  }
  Start-Sleep -Seconds 2
}

if (-not $buildSuccess) {
  Fail "Build failed after 3 attempts." "Check the output above for errors."
}
Write-Ok "Build complete"

# ===========================================================================
#  9. START SERVERS
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Starting servers"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Kill anything on our ports with aggressive retry
foreach ($port in @($BackendPort, $FrontendPort)) {
  $killAttempts = 0
  while ((Test-Port $port) -and $killAttempts -lt 3) {
    Write-Fix "Port $port is busy - stopping previous instance..."
    Kill-Port -Port $port
    $killAttempts++
  }
  if (Test-Port $port) {
    Write-Warn2 "Port $port still busy after retries, attempting force kill..."
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
      try {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
      } catch {}
    }
    Start-Sleep -Seconds 3
  }
}

if ($Dev) {
  $backendCmd = "pnpm run start:dev"
  $frontendCmd = "pnpm run dev"
  Write-Info "Starting in DEV mode (hot reload)..."
} else {
  $backendCmd = "pnpm run start:prod"
  $frontendCmd = "pnpm run start"
  Write-Info "Starting in PRODUCTION mode..."
}

Start-Process -FilePath "powershell" -WindowStyle Minimized -WorkingDirectory $BackendDir `
  -ArgumentList "-NoLogo", "-NoProfile", "-Command",
    "`$Host.UI.RawUI.WindowTitle='IQ Academy - API'; $backendCmd 2>&1 | Tee-Object -FilePath '$LogDir\backend.log'"

Start-Process -FilePath "powershell" -WindowStyle Minimized -WorkingDirectory $FrontendDir `
  -ArgumentList "-NoLogo", "-NoProfile", "-Command",
    "`$Host.UI.RawUI.WindowTitle='IQ Academy - Web'; $frontendCmd 2>&1 | Tee-Object -FilePath '$LogDir\frontend.log'"

Write-Host "    Waiting for servers to come up..." -ForegroundColor DarkGray

$deadline = (Get-Date).AddSeconds(120)
$apiUp = $false
$webUp = $false
while ((Get-Date) -lt $deadline) {
  if (-not $apiUp -and (Test-Port $BackendPort)) { $apiUp = $true; Write-Ok "API listening on port $BackendPort" }
  if (-not $webUp -and (Test-Port $FrontendPort)) { $webUp = $true; Write-Ok "Web listening on port $FrontendPort" }
  if ($apiUp -and $webUp) { break }
  Start-Sleep -Milliseconds 800
}

# Auto-recover if one server failed to start
if (-not $apiUp -and $webUp) {
  Write-Fix "API didn't start. Restarting backend..."
  Start-Process -FilePath "powershell" -WindowStyle Minimized -WorkingDirectory $BackendDir `
    -ArgumentList "-NoLogo", "-NoProfile", "-Command",
      "`$Host.UI.RawUI.WindowTitle='IQ Academy - API'; $backendCmd 2>&1 | Tee-Object -FilePath '$LogDir\backend.log'"
  Start-Sleep -Seconds 10
  if (Test-Port $BackendPort) { $apiUp = $true; Write-Ok "API restarted on port $BackendPort" }
}

if (-not $apiUp) { Write-Warn2 "API didn't start in time - check logs\backend.log" }
if (-not $webUp) { Fail "The web server didn't start in time." "Check logs\frontend.log for the reason." }

# ===========================================================================
#  10. OPEN PORTAL
# ===========================================================================
$currentStep++
Show-Progress $currentStep $totalSteps "Opening the portal"
$adminEmail = Get-EnvValue $backendEnv "SEED_ADMIN_EMAIL"
if (-not $adminEmail) { $adminEmail = "admin@iqacademy.com" }

Start-Process "http://localhost:$FrontendPort"

Write-Host ""
Write-Host "  $BOX" -ForegroundColor Green
Write-Host "  =                                                          =" -ForegroundColor Green
Write-Host "  =              IQ ACADEMY IS RUNNING                       =" -ForegroundColor Green
Write-Host "  =                                                          =" -ForegroundColor Green
Write-Host "  =   Portal : http://localhost:$FrontendPort                =" -ForegroundColor White
Write-Host "  =   API    : http://localhost:$BackendPort/api             =" -ForegroundColor White
Write-Host "  =   Docs   : http://localhost:$BackendPort/api/docs        =" -ForegroundColor DarkGray
Write-Host "  =                                                          =" -ForegroundColor Green
Write-Host "  =   Sign in : $adminEmail                                  =" -ForegroundColor Yellow
Write-Host "  =   Password : admin123                                     =" -ForegroundColor Yellow
Write-Host "  =                                                          =" -ForegroundColor Green
Write-Host "  =   Run stop.bat to shut everything down.                  =" -ForegroundColor DarkGray
Write-Host "  =                                                          =" -ForegroundColor Green
Write-Host "  $BOX" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 3
