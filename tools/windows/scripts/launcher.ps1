<#
  SCHOOL MANAGEMENT SYSTEM - one-click launcher.

  Starts PostgreSQL (existing server, native Windows service, or a private
  portable one), applies migrations, then starts the API and the web portal.

  DATA SAFETY: this script never resets, drops, or force-pushes the database.
  If migrations cannot be applied it stops and tells you, leaving the data
  exactly as it was. Backups are managed from the app (Settings -> Database Backup).

  No Docker required. Run it via tools\windows\start.bat.
#>
[CmdletBinding()]
param(
  # Build and run production servers instead of the dev servers.
  [switch]$Prod,
  # Show running status and exit without starting anything.
  [switch]$Status
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Root        = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$RootScripts = $PSScriptRoot
$BackendDir  = Join-Path $Root "apps\backend"
$FrontendDir = Join-Path $Root "apps\frontend"
$LogDir      = Join-Path $Root "logs"
$BackupDir   = Join-Path $Root "backups"

# Defaults; PORT in apps\backend\.env overrides the API port once the config
# step has read it, so a machine that has to move off 3001 only says so once.
$BackendPort  = 3001
$FrontendPort = 3000

# --- console presentation --------------------------------------------------
. (Join-Path $PSScriptRoot "ui.ps1")

# Build step is only present with -Prod, so the progress bar counts accordingly.
Initialize-Ui -TotalSteps $(if ($Prod) { 8 } else { 7 })

function Fail {
  param([string]$Message, [string]$Hint)
  Write-Host ""
  Write-Panel -Title "STARTUP FAILED" -Colour Red -Icon fail -Note (Get-UiElapsed) -Rows @(
    $Message
  )
  if ($Hint) {
    Write-Host "  $Hint" -ForegroundColor Yellow
    Write-Host ""
  }
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

<#
  Which process is holding a port, as "name (PID nnn)".

  Used to turn "the port is busy" into a sentence an operator can act on. It is
  best-effort: Get-NetTCPConnection needs no elevation for the lookup, but the
  owning process may belong to another user and refuse to identify itself.
#>
function Get-PortOwner {
  param([int]$Port)
  try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { return $null }
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) { return "$($proc.ProcessName) (PID $($listener.OwningProcess))" }
    return "PID $($listener.OwningProcess)"
  } catch { return $null }
}

<#
  Is the thing on this port *our* server, or something else that happens to
  have taken the port?

  The launcher used to treat any listener as "already running" and report
  success, so a stray process on 3000 produced a green panel and a browser
  window showing someone else's page — or nothing at all.

  Returns "ours", "foreign" or "unknown", and the distinction matters more than
  it looks: only "foreign" is worth stopping for. A dev-mode portal compiles
  each route on first request, so a perfectly healthy server that has just
  started can take longer to answer than any sane probe will wait — treating
  that silence as a conflict would replace a rare wrong success with a common
  wrong failure. Timeouts are therefore "unknown" and the start continues.
#>
function Test-OurServer {
  param([int]$Port, [ValidateSet("api", "web")][string]$Kind)
  $url = if ($Kind -eq "api") { "http://127.0.0.1:$Port/api/system-settings" } else { "http://127.0.0.1:$Port/login" }
  try {
    $res = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 2 -ErrorAction Stop
    if ($Kind -eq "api") {
      # Every response passes through the transform interceptor's envelope.
      if ($res.Content -match '"data"') { return "ours" }
      return "foreign"
    }
    if ($res.Headers["Content-Type"] -match "text/html") { return "ours" }
    return "foreign"
  } catch {
    $response = $_.Exception.Response
    if (-not $response) {
      # No HTTP response at all: refused mid-handshake, reset, or timed out.
      # Not enough to convict — the readiness wait below is the real check.
      return "unknown"
    }
    # A redirect to the login page is the portal behaving correctly.
    $status = $response.StatusCode.value__
    if ($Kind -eq "web" -and ($status -eq 307 -or $status -eq 302)) { return "ours" }
    if ($status -ge 500) { return "unknown" }
    return "foreign"
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

function Find-Tool {
  param([string]$Name, [string]$PgBin)
  if ($PgBin) {
    $candidate = Join-Path $PgBin "$Name.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  $portable = Join-Path $Root ".postgres\runtime"
  if (Test-Path $portable) {
    $found = Get-ChildItem $portable -Filter "$Name.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $native = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$Name.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
  if ($native) { return $native.FullName }
  return $null
}

# ===========================================================================
#  BANNER
# ===========================================================================
Clear-Host
$bannerName = Get-EnvValue (Join-Path $BackendDir ".env") "SCHOOL_NAME"
if (-not $bannerName) { $bannerName = "School Management System" }
Write-Banner -Title $bannerName -Subtitle $(
  if ($Prod) { "School Management   -   production mode" }
  else { "School Management" }
)
# ===========================================================================
#  MACHINE BINDING (anti-copy protection)
# ===========================================================================
Write-Step "Checking the machine licence (anti-copy)"

$machineScript = Join-Path $RootScripts "machine-id.ps1"
& powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $machineScript -Action check
$machineCode = $LASTEXITCODE

if ($machineCode -eq 2) {
  Write-Info "First run on this computer - binding the project to this machine..."
  & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $machineScript -Action bind
  $machineCode = $LASTEXITCODE
  if ($machineCode -eq 0) {
    Write-Ok "Project bound to this computer" "running licence granted"
  } else {
    Fail "Could not bind this project to the computer." "Close extra windows and run start.bat again; if it persists, contact support."
  }
} elseif ($machineCode -eq 1) {
  Fail "THIS COPY OF THE PROJECT IS BOUND TO A DIFFERENT COMPUTER - startup blocked." "Copying the project to another computer (USB drive, hard disk) is not allowed. To run it on this computer, contact the project provider. (Deleting machine.lock in the project folder would rebind it to this machine - reserved for the manager.)"
} elseif ($machineCode -eq 0) {
  Write-Ok "Machine licence verified" "machine.lock OK"
} else {
    Write-Warn2 "Machine check returned an unknown code ($machineCode) - continuing"
  }

  if ($Status) {
    foreach ($port in 3000, 3001) {
      $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($listener) {
        Write-Host "  Port $port : RUNNING (PID $($listener.OwningProcess))" -ForegroundColor Green
      } else {
        Write-Host "  Port $port : stopped" -ForegroundColor DarkGray
      }
    }
    exit 0
  }

  # ===========================================================================
#  1. TOOLCHAIN
# ===========================================================================
Write-Step "Checking prerequisites"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Info "Node.js not found - installing via winget..."
  try {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent 2>$null | Out-Null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
  } catch {
    Write-Warn2 "winget could not install Node.js: $($_.Exception.Message)"
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js could not be installed automatically." "Run 'winget install OpenJS.NodeJS.LTS' in a terminal, or install Node.js 20 LTS from https://nodejs.org, then run tools\windows\start.bat again."
  }
}

<#
  Version, not just presence.

  Next 14 needs Node 18.17+ and the toolchain is built against Node 20 LTS. An
  older Node does install and does start, then fails deep inside a build with a
  syntax error or a missing global, which reads as "the app is broken" rather
  than "this machine has Node 16". The floor is the `engines` field in the root
  package.json — one place to change it.
#>
$nodeVersion = (node --version) -replace "^v", ""
$requiredNode = "20.9.0"
try {
  $rootPkg = Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  if ($rootPkg.engines.node) { $requiredNode = ($rootPkg.engines.node -replace "[^0-9.]", "") }
} catch { }
if ([version]($nodeVersion -replace "-.*$", "") -lt [version]$requiredNode) {
  Fail "Node.js $nodeVersion is too old - this project needs $requiredNode or newer." `
       "Install Node.js 20 LTS (or newer): run 'winget install OpenJS.NodeJS.LTS' in a terminal, or download it from https://nodejs.org, then run tools\windows\start.bat again."
}
Write-Ok "Node.js" "v$nodeVersion (>= $requiredNode)"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Info "pnpm not found - enabling it via corepack..."
  try {
    corepack enable pnpm 2>$null | Out-Null
    corepack prepare pnpm@latest --activate 2>$null | Out-Null
  } catch {
    npm install -g pnpm 2>$null | Out-Null
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail "Could not install pnpm." "Run: npm install -g pnpm"
  }
}
Write-Ok "pnpm" (pnpm --version)

# ===========================================================================
#  2. CONFIGURATION
# ===========================================================================
Write-Step "Reading configuration"

$backendEnv  = Join-Path $BackendDir ".env"
$frontendEnv = Join-Path $FrontendDir ".env.local"

if (-not (Test-Path $backendEnv)) {
  # First run on a fresh machine: run the setup wizard (school name, admin
  # account, database identity - all generated as variables, nothing hard-coded).
  $setupScript = Join-Path $RootScripts "setup.ps1"
  if (Test-Path $setupScript) {
    Write-Info "First run detected - opening the setup wizard..."
    & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $setupScript
    $setupExit = $LASTEXITCODE
    if ($setupExit -ne 0) {
      Fail "Setup was not completed (setup.ps1 exited $setupExit)." "Run tools\windows\start.bat again and finish the school setup."
    }
    Write-Ok "School configuration created" (Get-EnvValue $backendEnv "SCHOOL_NAME")
  } else {
    Fail "apps\backend\.env is missing and the setup wizard is unavailable." "Reinstall the tools folder so setup.ps1 is present, or create .env manually with a DATABASE_URL line."
  }
}
if (-not (Test-Path $frontendEnv)) {
  $example = Join-Path $FrontendDir ".env.example"
  if (Test-Path $example) {
    Copy-Item $example $frontendEnv
    Write-Ok "Created apps\frontend\.env.local from .env.example"
  }
}

$schoolName = Get-EnvValue $backendEnv "SCHOOL_NAME"
if (-not $schoolName) { $schoolName = "School Management System" }

$configuredPort = Get-EnvValue $backendEnv "PORT"
if ($configuredPort -match "^\d+$") { $BackendPort = [int]$configuredPort }

$databaseUrl = Get-EnvValue $backendEnv "DATABASE_URL"
if (-not $databaseUrl) { Fail "DATABASE_URL is missing from apps\backend\.env" }
if ($databaseUrl -notmatch "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)") {
  Fail "DATABASE_URL in apps\backend\.env is not a valid PostgreSQL connection string."
}
$dbUser = $Matches[1]; $dbPass = $Matches[2]; $dbHost = $Matches[3]
$dbPort = [int]$Matches[4]; $dbName = $Matches[5]
Write-Ok "Database target" "$dbName @ $dbHost`:$dbPort"

# ===========================================================================
#  3. POSTGRESQL
# ===========================================================================
Write-Step "Starting PostgreSQL"

$pgBin = $null
try {
  <#
    Stay quiet when a server is already up - the launcher reports that outcome
    itself, and the helper's own progress lines break the step formatting.
    When nothing is listening it may have to download and initialise a server,
    so let it narrate: a silent 44 MB download is indistinguishable from a hang.
  #>
$pgAlreadyUp = Test-Port $dbPort
$superPassword = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
if (-not $superPassword) { $superPassword = "" }
$pgBin = & (Join-Path $RootScripts "ensure-postgres.ps1") -Port $dbPort -SuperPassword $superPassword -Quiet:$pgAlreadyUp
} catch {
  Fail "Could not start PostgreSQL: $($_.Exception.Message)" `
       "Run tools\windows\start.bat again - it will resume automatically, or install PostgreSQL 16 from https://www.postgresql.org/download/windows/"
}
if (-not (Test-Port $dbPort)) {
  Fail "Nothing is listening on port $dbPort." "PostgreSQL did not start. See the messages above."
}
Write-Ok "PostgreSQL accepting connections" "port $dbPort"

$psql = Find-Tool -Name "psql" -PgBin $pgBin

# Can the application already log in? On an established install this is the
# whole story, and we never need superuser rights.
$appLoginOk = $false
$tableCount = -1
if ($psql) {
  $env:PGPASSWORD = $dbPass
  $tables = & $psql -U $dbUser -h $dbHost -p $dbPort -d $dbName -tAc `
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null
  if ($LASTEXITCODE -eq 0 -and $tables -match "^\d+$") {
    $appLoginOk = $true
    $tableCount = [int]$tables
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ($appLoginOk) {
  Write-Ok "Connected to '$dbName'" "$tableCount tables"
} elseif ($psql) {
  # Fresh machine: create the role and database as the superuser.
  Write-Info "Application login failed - setting up the role and database..."
  $superPass = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
  if (-not $superPass) { $superPass = "iq_academy_local" }
  $env:PGPASSWORD = $superPass

  $roleExists = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1 FROM pg_roles WHERE rolname='$dbUser'" 2>$null
  if ($roleExists -ne "1") {
    & $psql -U postgres -h $dbHost -p $dbPort -c "CREATE ROLE `"$dbUser`" LOGIN PASSWORD '$dbPass' CREATEDB" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Created role $dbUser" } else { Write-Warn2 "Could not create role $dbUser" }
  }

  $dbExists = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" 2>$null
  if ($dbExists -ne "1") {
    & $psql -U postgres -h $dbHost -p $dbPort -c "CREATE DATABASE `"$dbName`" OWNER `"$dbUser`"" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "Created database $dbName" } else { Write-Warn2 "Could not create database $dbName" }
  }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
} else {
  Write-Warn2 "psql not found - skipping the database check (drizzle-kit will report any problem)"
}

<#
  pg_trgm backs every "contains" search in the app (students, professors, the
  audit trail). Creating an extension needs superuser, which the application
  role deliberately is not, so drizzle-kit cannot do it - and without the
  extension the GIN search indexes fail to build.

  Runs on every start, not just on a fresh machine: existing installations
  predate the extension and need it too. IF NOT EXISTS makes the repeat free.
#>
if ($psql) {
  $superPass = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
  if (-not $superPass) { $superPass = "iq_academy_local" }
  $env:PGPASSWORD = $superPass

  $hasTrgm = & $psql -U postgres -h $dbHost -p $dbPort -d $dbName -tAc "SELECT 1 FROM pg_extension WHERE extname='pg_trgm'" 2>$null
  if ($hasTrgm -ne "1") {
    & $psql -U postgres -h $dbHost -p $dbPort -d $dbName -c "CREATE EXTENSION IF NOT EXISTS pg_trgm" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Ok "Enabled pg_trgm" "text search indexes"
    } else {
      Write-Warn2 "Could not enable pg_trgm - text searches will fall back to full scans"
    }
  }

  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

<#
  Guard against pointing at the wrong server. An empty database on a machine
  that already has backups usually means something else has taken port
  $dbPort (a Docker container, a second PostgreSQL install) and the real data
  is elsewhere. Migrating would build a fresh, empty schema and the system
  would look wiped, so stop and let a human decide.
#>
if ($appLoginOk -and $tableCount -eq 0) {
  $existingDumps = @(Get-ChildItem (Join-Path $BackupDir "iq-academy-*.dump") -ErrorAction SilentlyContinue)
  if ($existingDumps.Count -gt 0) {
    Write-Host ""
    Write-Warn2 "The database '$dbName' on port $dbPort is EMPTY, but $($existingDumps.Count) backup(s) exist."
    Write-Info "Another PostgreSQL server may be using port $dbPort, with your real data on the original one."
    Write-Info "Continuing will set up an empty system. Your backups will NOT be touched."
    Write-Info "To restore the most recent backup instead, close this window and use the Database Backup page in the app."
    Write-Host ""
    $answer = Read-Host "  Continue with the empty database? Type YES to continue"
    if ($answer -ne "YES") { Fail "Stopped at your request. Nothing was changed." "Start the app and use the Database Backup page to restore a backup." }
  }
}

# ===========================================================================
#  4. DEPENDENCIES
# ===========================================================================
Write-Step "Checking dependencies"

$needsInstall = (-not (Test-Path (Join-Path $Root "node_modules"))) -or
                (-not (Test-Path (Join-Path $BackendDir "node_modules"))) -or
                (-not (Test-Path (Join-Path $FrontendDir "node_modules")))

if ($needsInstall) {
  Write-Info "Installing packages (the first run takes a few minutes)..."
  Push-Location $Root
  pnpm install 2>$null | Out-Null
  $installExit = $LASTEXITCODE
  Pop-Location
  if ($installExit -ne 0) { Fail "pnpm install failed." "Check your internet connection and run tools\windows\start.bat again." }
  Write-Ok "Packages installed"
} else {
  Write-Ok "Packages up to date"
}

# ===========================================================================
#  5. DATABASE SCHEMA
# ===========================================================================
Write-Step "Applying database schema"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Skip the introspection+diff (a few seconds) when the schema definitions have
# not changed since the last successful push. The hash is kept per machine.
$schemaState = Join-Path $LogDir "schema.hash"
$schemaHash = ""
foreach ($file in @(
  (Join-Path $BackendDir "src\db\schema.ts"),
  (Join-Path $BackendDir "src\db\relations.ts"),
  (Join-Path $BackendDir "drizzle.config.ts")
)) {
  if (Test-Path $file) { $schemaHash += (Get-FileHash -Algorithm SHA256 -Path $file).Hash }
}
$pushNeeded = $true
if ($schemaHash -and (Test-Path $schemaState)) {
  if ((Get-Content $schemaState -Raw).Trim() -eq $schemaHash) { $pushNeeded = $false }
}

if ($pushNeeded) {
  # ==========================================================================
  #  Pre-push repair: ownership + orphan cleanup.
  #  On cloned installs the tables may still be owned by the superuser, so
  #  drizzle-kit push (which connects as the app user) cannot ALTER them.
  #  Also clean up orphaned schedule_entries that would block FK additions.
  # ==========================================================================
  if ($psql -and $appLoginOk) {
    $env:PGPASSWORD = $dbPass
    $nonOwnerTables = & $psql -U $dbUser -h $dbHost -p $dbPort -d $dbName -tAc `
      "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner<>'$dbUser'" 2>$null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

    if ($LASTEXITCODE -eq 0 -and [int]$nonOwnerTables -gt 0) {
      $superPass = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
      if ($superPass) {
        Write-Info "Repairing ownership of $nonOwnerTables table(s) for drizzle-kit push..."
        $env:PGPASSWORD = $superPass
        <#
          Every mis-owned table, found by asking the catalogue, rather than a
          hard-coded list. The list version named the four scheduling tables and
          the role of one particular school, so a table added later — or any
          other install — was not covered by it and pushed into the same
          failure it exists to prevent.
        #>
        $reassign = "DO `$`$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner<>'$dbUser' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t.tablename, '$dbUser'); END LOOP; END `$`$;"
        & $psql -U postgres -h $dbHost -p $dbPort -d $dbName -c $reassign 2>$null | Out-Null
        $ownerFixExit = $LASTEXITCODE
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

        if ($ownerFixExit -eq 0) {
          Write-Ok "Table ownership repaired"
        } else {
          Write-Warn2 "Could not repair table ownership - drizzle-kit push may fail"
        }
      }
    }

    $env:PGPASSWORD = $dbPass
    $orphanCount = & $psql -U $dbUser -h $dbHost -p $dbPort -d $dbName -tAc `
      "SELECT count(*) FROM schedule_entries WHERE group_id NOT IN (SELECT id FROM groups)" 2>$null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

    if ($LASTEXITCODE -eq 0 -and [int]$orphanCount -gt 0) {
      Write-Info "Cleaning up $orphanCount orphaned schedule entry/entries..."
      $env:PGPASSWORD = $dbPass
      & $psql -U $dbUser -h $dbHost -p $dbPort -d $dbName -c "DELETE FROM schedule_entries WHERE group_id NOT IN (SELECT id FROM groups);" 2>$null | Out-Null
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
      Write-Ok "Orphaned schedule entries removed"
    }
  }

  Push-Location $BackendDir
  $pushOutput = pnpm exec drizzle-kit push --force 2>&1
  $pushExit = $LASTEXITCODE
  Pop-Location

  if ($pushExit -ne 0) {
    $looksLikeDepIssue = $pushOutput -match "Cannot find module|MODULE_NOT_FOUND|drizzle-kit|Command .* not found"
    if ($looksLikeDepIssue) {
      Write-Info "drizzle-kit push failed - dependency issue detected, repairing..."
      Push-Location $Root
      $repairOutput = pnpm install 2>&1
      $repairExit = $LASTEXITCODE
      Pop-Location

      if ($repairExit -eq 0) {
        Push-Location $BackendDir
        $pushOutput = pnpm exec drizzle-kit push --force 2>&1
        $pushExit = $LASTEXITCODE
        Pop-Location
      } else {
        $pushOutput = $repairOutput
      }
    }
  }

  if ($pushExit -ne 0) {
    $pushOutput | ForEach-Object { Write-Info "  $_" }
    Fail "Database schema could not be applied - your data has NOT been changed." `
         "Fix the error above, then run tools\windows\start.bat again. If you need to restore data, use the Database Backup page in the app."
  }
  Set-Content -Path $schemaState -Value $schemaHash
  Write-Ok "Database schema is up to date"
} else {
  Write-Ok "Database schema is up to date" "push skipped - schema unchanged"
}

# The admin account seed is an upsert - it never touches existing data. Skip
# it entirely (saving a cold ts-node start, ~12s) when the account and the
# settings rows it creates are already present.
$seedNeeded = $true
if ($psql) {
  $env:PGPASSWORD = $dbPass
  $seedCount = & $psql -U $dbUser -h $dbHost -p $dbPort -d $dbName -tAc `
    "SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM system_settings)" 2>$null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -eq 0 -and $seedCount -match "^\d+$" -and [int]$seedCount -ge 2) { $seedNeeded = $false }
}
if ($seedNeeded) {
  Push-Location $BackendDir
  pnpm run db:seed 2>&1 | Out-Null
  Pop-Location
  if ($LASTEXITCODE -ne 0) { Fail "Administrator seed failed." "Check the SEED_ADMIN_* variables in apps\backend\.env." }
  Write-Ok "Administrator account ready"
} else {
  Write-Ok "Administrator account ready" "seed skipped - already present"
}

# ===========================================================================
#  6. BUILD (production mode only)
# ===========================================================================
if ($Prod) {
  Write-Step "Building the application"

  # Skip the full nest+next rebuild when no source file has changed since the
  # last build; dist/.next are left untouched in that case. The hash covers
  # sources and the lockfile only - node_modules/.next/dist/public etc. are
  # build outputs or dependencies, not inputs.
  $rebuildNeeded = $true
  $buildState = Join-Path $LogDir "build.hash"
  $buildInputs = Get-ChildItem $BackendDir, $FrontendDir -Recurse -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -notmatch "\\(node_modules|\.next|dist|logs|backups|\.postgres|public)\\" }
  $buildHash = ""
  foreach ($file in $buildInputs) {
    $buildHash += (Get-FileHash -Algorithm SHA256 -Path $file.FullName).Hash
  }
  if ($buildHash -and (Test-Path $buildState)) {
    if ((Get-Content $buildState -Raw).Trim() -eq $buildHash) { $rebuildNeeded = $false }
  }

  if ($rebuildNeeded) {
    Push-Location $Root
    pnpm build 2>&1 | Out-Null
    $buildExit = $LASTEXITCODE
    Pop-Location
    if ($buildExit -ne 0) { Fail "Build failed." "Run 'pnpm build' to see the error, or start without -Prod." }
    Set-Content -Path $buildState -Value $buildHash
    Write-Ok "Build complete"
  } else {
    Write-Ok "Build is up to date" "sources unchanged - build skipped"
  }
}

# ===========================================================================
#  7. START SERVERS
# ===========================================================================
Write-Step "Starting servers"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if ($Prod) {
  $backendCmd  = "pnpm run start:prod"
  $frontendCmd = "pnpm run start"
} else {
  $backendCmd  = "pnpm run start:dev"
  $frontendCmd = "pnpm run dev"
}

<#
  A busy port is one of two very different situations, and they were treated as
  one: our own server already running (fine, reuse it) or a foreign process
  squatting on it (nothing will work, and starting ours will fail silently in a
  minimised window). Ask the port what it is before deciding.
#>
foreach ($check in @(
  @{ Port = $BackendPort; Kind = "api"; Label = "API" },
  @{ Port = $FrontendPort; Kind = "web"; Label = "Web portal" }
)) {
  if (-not (Test-Port $check.Port)) { continue }
  $verdict = Test-OurServer -Port $check.Port -Kind $check.Kind
  if ($verdict -ne "foreign") { continue }

  $owner = Get-PortOwner -Port $check.Port
  $who = if ($owner) { ": $owner" } else { "" }
  $hint = "Close that program and run tools\windows\start.bat again, or free the port with:  npx kill-port $($check.Port)"
  if ($check.Kind -eq "api") {
    $hint += "  |  To move the API instead, set PORT in apps\backend\.env and NEXT_PUBLIC_API_URL in apps\frontend\.env.local to match."
  }
  Fail "Port $($check.Port) is in use by another program$who - the $($check.Label) cannot start." $hint
}

$apiUp = Test-Port $BackendPort
$webUp = Test-Port $FrontendPort

if ($apiUp) {
  Write-Ok "API already running" "port $BackendPort"
} else {
  $backendProc = Start-Process -FilePath "powershell" -WindowStyle Minimized -WorkingDirectory $BackendDir -PassThru `
    -ArgumentList "-NoLogo", "-NoProfile", "-Command",
      "`$Host.UI.RawUI.WindowTitle='SCHOOL MANAGEMENT SYSTEM - API'; $backendCmd 2>&1 | Tee-Object -FilePath '$LogDir\backend.log'"
  if ($backendProc) { $backendProc.Id | Out-File -FilePath (Join-Path $LogDir "backend.pid") -Encoding ascii }
}

if ($webUp) {
  Write-Ok "Web portal already running" "port $FrontendPort"
} else {
  $webProc = Start-Process -FilePath "powershell" -WindowStyle Minimized -WorkingDirectory $FrontendDir -PassThru `
    -ArgumentList "-NoLogo", "-NoProfile", "-Command",
      "`$Host.UI.RawUI.WindowTitle='SCHOOL MANAGEMENT SYSTEM - Web'; $frontendCmd 2>&1 | Tee-Object -FilePath '$LogDir\frontend.log'"
  if ($webProc) { $webProc.Id | Out-File -FilePath (Join-Path $LogDir "frontend.pid") -Encoding ascii }
}

if (-not $apiUp -or -not $webUp) {
  # Wait for BOTH ports at once (one spinner, timeout = the slower server)
  # instead of sequentially - on a cold start that saves the whole boot time
  # of whichever one comes up first.
  $ready = Wait-For -Condition { (Test-Port $BackendPort) -and (Test-Port $FrontendPort) } `
                    -Label "Starting API and web portal" -TimeoutSec 150
  if ($ready) {
    $apiUp = $true
    $webUp = $true
    Write-Ok "API listening" "port $BackendPort"
    Write-Ok "Web portal listening" "port $FrontendPort"
  } else {
    $apiUp = Test-Port $BackendPort
    $webUp = Test-Port $FrontendPort
  }
}

if (-not $apiUp) { Write-Warn2 "The API did not start in time - see logs\backend.log" }
if (-not $webUp) { Fail "The web portal did not start in time." "See logs\frontend.log for the reason." }

<#
  The portal compiles each route on first request, which makes the first page
  visit feel like a hang (~10-15s on a cold start). Warm the main routes in
  the background now, while the launcher finishes, so the browser is instant.
  The warm script exits on its own; stop.ps1 never sees it.
#>
if ($webUp -and -not $Prod) {
  $prewarmScript = Join-Path $Root "scripts\prewarm.mjs"
  if (Test-Path $prewarmScript) {
    Write-Info "Pre-warming web routes in the background..."
    Start-Process -FilePath "node" -WindowStyle Hidden -WorkingDirectory $Root `
      -ArgumentList $prewarmScript, $FrontendPort
  }
}

# ===========================================================================
#  8. READY
# ===========================================================================
$adminEmail = Get-EnvValue $backendEnv "SEED_ADMIN_EMAIL"
if (-not $adminEmail) { $adminEmail = "see apps\backend\.env (SEED_ADMIN_EMAIL)" }

# Row count for the panel - reassures the operator the data is really there.
$studentCount = $null
if ($psql) {
  $env:PGPASSWORD = $dbPass
  $counted = & $psql -U $dbUser -h $dbHost -p $dbPort -d $dbName -tAc "SELECT count(*) FROM students" 2>$null
  if ($LASTEXITCODE -eq 0 -and $counted -match "^\d+$") { $studentCount = [int]$counted }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Start-Process "http://localhost:$FrontendPort"

Write-Panel -Title "$schoolName IS RUNNING" -Colour Green -Note ("ready in " + (Get-UiElapsed)) -Rows @(
  "---",
  "Portal|http://localhost:$FrontendPort",
  "API docs|http://localhost:$BackendPort/api/docs",
  "Sign in|$adminEmail",
  "---",
  $(if ($null -ne $studentCount) { "Data|$dbName - $studentCount students" } else { "Data|$dbName on port $dbPort" }),
  "Backups|manage in the app (Settings -> Database Backup)",
  "Stop|the power button in the app"
)

Write-Host "  This window can be closed - the servers keep running." -ForegroundColor DarkGray
Write-Host ""
Start-Sleep -Seconds 4
