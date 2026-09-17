<#
  SCHOOL MANAGEMENT SYSTEM - one-click launcher.

  Starts PostgreSQL (existing server, native Windows service, or a private
  portable one), applies migrations, then starts the API and the web portal.

  DATA SAFETY: this script never resets, drops, or force-pushes the database.
  If migrations cannot be applied it stops and tells you, leaving the data
  exactly as it was. Backups are managed from the app (Settings -> Database Backup).

  No Docker required. Started by the desktop control panel.
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

$Root        = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
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

<#
  Rewrites one KEY=value line in a .env file in place (first match wins),
  appending the key when absent. Used by the auto-fix steps below so a
  repaired configuration persists across restarts instead of warning again.
#>
function Set-EnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  if (-not (Test-Path $Path)) { return }
  $lines = @(Get-Content $Path)
  $done = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=.*$") { $lines[$i] = "$Key=$Value"; $done = $true; break }
  }
  if (-not $done) { $lines += "$Key=$Value" }
  Set-Content -Path $Path -Value $lines -Encoding UTF8
}

# CSPRNG alphanumeric key for the install API (x-api-key). Same alphabet as
# the setup wizard's New-RandomString, so the value is header- and URL-safe.
function New-ApiKey {
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  $sb = New-Object System.Text.StringBuilder
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $buf = New-Object byte[] 1
  for ($i = 0; $i -lt 32; $i++) {
    do { $rng.GetBytes($buf) } while ($buf[0] -ge 248)
    [void]$sb.Append($chars[$buf[0] % $chars.Length])
  }
  return $sb.ToString()
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
    Fail "Could not bind this project to the computer." "Close extra windows and start again from the desktop shortcut; if it persists, contact support."
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
    Fail "Node.js could not be installed automatically." "Run 'winget install OpenJS.NodeJS.LTS' in a terminal, or install Node.js 20 LTS from https://nodejs.org, then start the system again from the desktop shortcut."
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
       "Install Node.js 20 LTS (or newer): run 'winget install OpenJS.NodeJS.LTS' in a terminal, or download it from https://nodejs.org, then start the system again from the desktop shortcut."
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
      Fail "Setup was not completed (setup.ps1 exited $setupExit)." "Start the system again from the desktop shortcut and finish the school setup."
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

# Upgrade backfill: installs created before the install API key existed have
# neither value, and the API now refuses keyed routes without one.
$installApiKey = Get-EnvValue $backendEnv "API_KEY"
if (-not $installApiKey) {
  $installApiKey = New-ApiKey
  Add-Content -Path $backendEnv -Value "API_KEY=$installApiKey"
  Write-Ok "Generated install API key" "apps\backend\.env"
}
if ((Test-Path $frontendEnv) -and (-not (Get-EnvValue $frontendEnv "NEXT_PUBLIC_API_KEY"))) {
  $frontLines = @(Get-Content $frontendEnv | Where-Object { $_ -notmatch "^\s*NEXT_PUBLIC_API_KEY\s*=" })
  $frontLines += "NEXT_PUBLIC_API_KEY=$installApiKey"
  Set-Content -Path $frontendEnv -Value $frontLines -Encoding UTF8
  Write-Ok "Synced install API key" "apps\frontend\.env.local"
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
# Capture the URL parts now: every Get-EnvValue call below runs its own
# -match and clobbers the automatic $Matches variable (the old fallbacks
# below used to read those stale groups).
$urlUser = $Matches[1]
$urlPass = $Matches[2]
$urlHost = $Matches[3]
$urlPort = [int]$Matches[4]
$urlDb = ($Matches[5] -split '\?')[0]
$dbUser = Get-EnvValue $backendEnv "DATABASE_USER"
if (-not $dbUser) { $dbUser = $urlUser }
$dbPass = Get-EnvValue $backendEnv "DATABASE_PASSWORD"
if (-not $dbPass) { $dbPass = $urlPass }
$dbHost = $urlHost
$dbPort = $urlPort
$dbName = Get-EnvValue $backendEnv "DATABASE_NAME"
if (-not $dbName -or $dbName -match '^\s*=' -or $dbName -eq "public") {
  if ($urlDb -and $urlDb -notmatch '^\s*=' -and $urlDb -ne "public") {
    $dbName = $urlDb
  } else {
    $dbName = "school_db"
  }
}
Write-Ok "Database target" "$dbName @ $dbHost`:$dbPort"
# The app connects with DATABASE_URL while the scripts below use the split
# fields — if they disagree, say so now instead of failing halfway through.
if ($urlUser -and $dbUser -ne $urlUser) {
  Write-Warn2 "DATABASE_USER ($dbUser) disagrees with DATABASE_URL ($urlUser) - the app uses the URL."
}
if ($urlDb -and $dbName -ne $urlDb) {
  Write-Warn2 "DATABASE_NAME ($dbName) disagrees with DATABASE_URL ($urlDb) - the app uses the URL."
}

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
       "Start the system again from the desktop shortcut - it will resume automatically, or install PostgreSQL 16 from https://www.postgresql.org/download/windows/"
}

# Re-read database configuration from .env in case ensure-postgres auto-switched ports
$databaseUrl = Get-EnvValue $backendEnv "DATABASE_URL"
if ($databaseUrl -match "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)") {
  $dbPort = [int]$Matches[4]
}

if (-not (Test-Port $dbPort)) {
  Fail "Nothing is listening on port $dbPort." "PostgreSQL did not start. See the messages above."
}
Write-Ok "PostgreSQL accepting connections" "port $dbPort"

$psql = Find-Tool -Name "psql" -PgBin $pgBin

<#
  Ensures the application role and database exist via the first working
  superuser password. Returns that password, or $null when no candidate
  authenticates. Reads the live $psql/$dbHost/$dbPort/$dbUser/$dbPass/$dbName
  variables at call time so the portable fallback can reuse it after
  switching ports.
#>
function Ensure-AppRoleAndDb {
  param([switch]$FixPassword)
  $candidates = @(
    (Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"),
    "iq_academy_local",
    "postgres",
    ""
  ) | Where-Object { $_ -ne $null } | Select-Object -Unique

  $working = $null
  foreach ($sp in $candidates) {
    $env:PGPASSWORD = $sp
    & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $working = $sp; break }
  }
  if ($null -eq $working) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; return $null }

  $env:PGPASSWORD = $working
  $roleExists = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1 FROM pg_roles WHERE rolname='$dbUser'" 2>$null
  if ($roleExists -ne "1") {
    $sqlFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $sqlFile -Value ("CREATE ROLE " + [char]34 + $dbUser + [char]34 + " WITH LOGIN PASSWORD '" + $dbPass + "' CREATEDB;") -Encoding ascii
    & $psql -U postgres -h $dbHost -p $dbPort -f $sqlFile 2>$null | Out-Null
    $roleCode = $LASTEXITCODE
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    if ($roleCode -eq 0) { Write-Ok "Created role $dbUser" } else { Write-Warn2 "Could not create role $dbUser" }
  } elseif ($FixPassword) {
    # The role exists but the application login failed with the .env
    # password (hand-edited or forgotten): align the role to .env, which is
    # what the app authenticates with. Single quotes are doubled so any
    # password stays one SQL string literal.
    $safePass = $dbPass -replace "'", "''"
    $sqlFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $sqlFile -Value ("ALTER ROLE " + [char]34 + $dbUser + [char]34 + " WITH LOGIN PASSWORD '" + $safePass + "';") -Encoding ascii
    & $psql -U postgres -h $dbHost -p $dbPort -f $sqlFile 2>$null | Out-Null
    $alterCode = $LASTEXITCODE
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    if ($alterCode -eq 0) { Write-Ok "Reset password for role $dbUser" "matches apps\backend\.env" }
  }

  $dbExists = & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" 2>$null
  if ($dbExists -ne "1") {
    $sqlFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $sqlFile -Value ("CREATE DATABASE " + [char]34 + $dbName + [char]34 + " OWNER " + [char]34 + $dbUser + [char]34 + ";") -Encoding ascii
    & $psql -U postgres -h $dbHost -p $dbPort -f $sqlFile 2>$null | Out-Null
    $dbCode = $LASTEXITCODE
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    if ($dbCode -eq 0) { Write-Ok "Created database $dbName" } else { Write-Warn2 "Could not create database $dbName" }
  }
  return $working
}

<#
  Last resort for an unknown native superuser password: when elevated, briefly
  switch the native cluster's loopback authentication to trust, set the
  superuser password to the .env value (or a fresh one), then restore
  pg_hba.conf and restart. Returns the working superuser password, or $null.
  Every failure restores the file and the service first - never fatal to the
  start. Only loopback lines are touched, and only for the duration.
#>
function Reset-NativeSuperViaHba {
  param([string]$Psql, [int]$Port)
  $backup = $null
  try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return $null }
    $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $svc) { return $null }
    $detail = Get-CimInstance Win32_Service -Filter "Name = '$($svc.Name)'" -ErrorAction SilentlyContinue
    if (-not $detail -or -not $detail.PathName) { return $null }
    $m = [regex]::Match($detail.PathName, '-D\s+"([^"]+)"')
    if (-not $m.Success) { $m = [regex]::Match($detail.PathName, '-D\s+(\S+)') }
    if (-not $m.Success) { return $null }
    $hba = Join-Path $m.Groups[1].Value "pg_hba.conf"
    if (-not (Test-Path $hba)) { return $null }
    $backup = "$hba.iq-bak"
    Copy-Item $hba $backup -Force
    $content = Get-Content $hba -Raw
    $relaxed = $content -replace '(?m)^(host\s+\S+\s+\S+\s+(?:127\.0\.0\.1/32|::1/128)\s+)\S+(\s*(?:#.*)?)$', '$1trust$2'
    if ($relaxed -eq $content) { return $null }
    Set-Content -Path $hba -Value $relaxed -Encoding ascii -NoNewline
    Restart-Service -Name $svc.Name -Force -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Port $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    if (-not (Test-Port $Port)) { return $null }
    $newSuper = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
    if (-not $newSuper) { $newSuper = New-ApiKey }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    & $Psql -U postgres -h $dbHost -p $Port -tAc "SELECT 1" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $null }
    $safe = $newSuper -replace "'", "''"
    $sqlFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $sqlFile -Value "ALTER USER postgres PASSWORD '$safe';" -Encoding ascii
    & $Psql -U postgres -h $dbHost -p $Port -f $sqlFile 2>$null | Out-Null
    $alterCode = $LASTEXITCODE
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    if ($alterCode -ne 0) { return $null }
    $env:PGPASSWORD = $newSuper
    & $Psql -U postgres -h $dbHost -p $Port -tAc "SELECT 1" 2>$null | Out-Null
    $verified = ($LASTEXITCODE -eq 0)
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if (-not $verified) { return $null }
    Copy-Item $backup $hba -Force
    Remove-Item $backup -Force -ErrorAction SilentlyContinue
    $backup = $null
    Restart-Service -Name $svc.Name -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Port $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    Set-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD" $newSuper
    Write-Ok "Recovered native superuser access" "password stored in apps\backend\.env"
    return $newSuper
  } catch { return $null }
  finally {
    if ($backup -and (Test-Path $backup)) {
      $hbaPath = $backup -replace '\.iq-bak$', ''
      Copy-Item $backup $hbaPath -Force -ErrorAction SilentlyContinue
      Remove-Item $backup -Force -ErrorAction SilentlyContinue
    }
  }
}

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
  $workingSuperPass = $null
} elseif ($psql) {
  # Fresh machine: create the role and database as the superuser.
  Write-Info "Application login failed - setting up the role and database..."
  $workingSuperPass = Ensure-AppRoleAndDb -FixPassword:(-not $appLoginOk)
  if ($null -eq $workingSuperPass -and $dbPort -ne 54325) {
    # Unknown superuser password, step 1: recover native access when elevated
    # (trust-reset, fully reverted afterwards). Step 2 below is the portable
    # fallback, which needs no password at all.
    $hbaPass = Reset-NativeSuperViaHba -Psql $psql -Port $dbPort
    if ($hbaPass) { $workingSuperPass = Ensure-AppRoleAndDb -FixPassword:$true }
    if ($null -eq $workingSuperPass) {
    <#
      Auto-solve for an unusable native PostgreSQL (unknown superuser
      password, foreign instance nobody maintains): move OUR database to a
      private portable cluster on port 54325, whose password is always known.
      The native server is never touched - it keeps running for whoever owns
      it - and existing backups are never touched either.
    #>
    Write-Warn2 "No superuser access on port $dbPort - switching to a private database on port 54325..."
    $rawEnv = Get-Content $backendEnv -Raw
    $rawEnv = $rawEnv -replace "@localhost:\d+/", "@localhost:54325/"
    $rawEnv = $rawEnv -replace "@127\.0\.0\.1:\d+/", "@127.0.0.1:54325/"
    Set-Content -Path $backendEnv -Value $rawEnv -Encoding UTF8 -NoNewline
    $databaseUrl = Get-EnvValue $backendEnv "DATABASE_URL"
    $dbPort = 54325
    try {
      $storedSuper = Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"
      if (-not $storedSuper) { $storedSuper = "" }
      $pgBin = & (Join-Path $RootScripts "ensure-postgres.ps1") -Port 54325 -SuperPassword $storedSuper -ForcePortable
      $psql = Find-Tool -Name "psql" -PgBin $pgBin
      if (($psql) -and (Test-Port $dbPort)) {
        Write-Ok "Private database running" "port 54325"
        $workingSuperPass = Ensure-AppRoleAndDb -FixPassword:$true
        if ($null -ne $workingSuperPass) {
          Write-Info "Role and database ready on the private server. If the old server held your real data, restore a backup from the Database Backup page."
        }
      }
    } catch {
      Write-Warn2 "Private database fallback failed: $($_.Exception.Message)"
    }
    }
  }
  if ($null -eq $workingSuperPass) {
    Write-Warn2 "Could not authenticate as superuser 'postgres' on port $dbPort - skipping role/database setup"
  }
} else {
  Write-Warn2 "psql not found - skipping the database check (drizzle-kit will report any problem)"
  $workingSuperPass = $null
}

<#
  Auto-fix a DATABASE_URL / split-field identity mismatch (e.g. a hand-edited
  .env pointing the URL at "public" while DATABASE_NAME says otherwise).
  Probes both databases with the working application credentials and keeps
  the one holding data; ties go to the URL because that is what the app
  connects with. The URL's own credentials are verified before the URL is
  ever rewritten. Warn-only when nothing can be probed.
#>
if ($psql -and $urlDb -and ($dbName -ne $urlDb) -and (Test-Port $dbPort)) {
  $probeCounts = @{}
  foreach ($candidateDb in @($urlDb, $dbName) | Select-Object -Unique) {
    $env:PGPASSWORD = $dbPass
    $n = & $psql -U $dbUser -h $dbHost -p $dbPort -d $candidateDb -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -eq 0 -and $n -match "^\d+$") { $probeCounts[$candidateDb] = [int]$n } else { $probeCounts[$candidateDb] = -1 }
  }
  $urlCount = $probeCounts[$urlDb]
  $splitCount = $probeCounts[$dbName]
  $winner = $null
  if ($urlCount -ge 0 -and $urlCount -ge $splitCount) { $winner = $urlDb }
  elseif ($splitCount -ge 0) { $winner = $dbName }
  if ($winner -and ($winner -ne $urlDb)) {
    $urlCredsOk = ($urlUser -eq $dbUser -and $urlPass -eq $dbPass)
    if (-not $urlCredsOk) {
      $env:PGPASSWORD = $urlPass
      & $psql -U $urlUser -h $dbHost -p $dbPort -d $dbName -tAc "SELECT 1" 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $urlCredsOk = $true }
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    if ($urlCredsOk) {
      $prefix = $databaseUrl.Substring(0, $databaseUrl.LastIndexOf("/") + 1)
      $suffix = ""
      if ($databaseUrl -match "(\?.*)$") { $suffix = $Matches[1] }
      $databaseUrl = "$prefix$winner$suffix"
      Set-EnvValue $backendEnv "DATABASE_URL" $databaseUrl
      Set-EnvValue $backendEnv "DATABASE_NAME" $winner
      $urlDb = $winner
      $dbName = $winner
      Write-Ok "Reconciled database identity" "app + scripts now use '$winner' ($splitCount vs $urlCount tables)"
    } else {
      Write-Warn2 "DATABASE_URL credentials cannot access '$dbName' - leaving .env untouched; fix the password or database name manually."
    }
  } elseif ($winner -and ($winner -ne $dbName)) {
    Set-EnvValue $backendEnv "DATABASE_NAME" $winner
    $dbName = $winner
    $urlDb = $winner
    Write-Ok "Reconciled database identity" "scripts now match DATABASE_URL ($urlCount tables)"
  }
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
  $superCandidates = @(
    (Get-EnvValue $backendEnv "POSTGRES_SUPERUSER_PASSWORD"),
    "iq_academy_local",
    "postgres",
    ""
  ) | Where-Object { $_ -ne $null } | Select-Object -Unique

  $workingSuperPass = $null
  foreach ($sp in $superCandidates) {
    $env:PGPASSWORD = $sp
    & $psql -U postgres -h $dbHost -p $dbPort -tAc "SELECT 1" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $workingSuperPass = $sp; break }
  }

  if ($null -ne $workingSuperPass) {
    $env:PGPASSWORD = $workingSuperPass
    $hasTrgm = & $psql -U postgres -h $dbHost -p $dbPort -d $dbName -tAc "SELECT 1 FROM pg_extension WHERE extname='pg_trgm'" 2>$null
    if ($hasTrgm -ne "1") {
      $sqlFile = [System.IO.Path]::GetTempFileName()
      Set-Content -Path $sqlFile -Value "CREATE EXTENSION IF NOT EXISTS pg_trgm;" -Encoding ascii
      & $psql -U postgres -h $dbHost -p $dbPort -d $dbName -f $sqlFile 2>$null | Out-Null
      $trgmCode = $LASTEXITCODE
      Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
      if ($trgmCode -eq 0) {
        Write-Ok "Enabled pg_trgm" "text search indexes"
      } else {
        Write-Warn2 "Could not enable pg_trgm - text searches will fall back to full scans"
      }
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
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
  if ($installExit -ne 0) { Fail "pnpm install failed." "Check your internet connection and start the system again from the desktop shortcut." }
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

  # `push --force` applies destructive statements without asking. Take a dump
  # first so a mistaken schema change is a restore, not a loss.
  & (Join-Path $PSScriptRoot "backup-before-schema.ps1") -Root $Root

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
         "Fix the error above, then start the system again from the desktop shortcut. If you need to restore data, use the Database Backup page in the app."
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
  $hint = "Close that program and start again from the desktop shortcut, or free the port with:  npx kill-port $($check.Port)"
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
      "`$ErrorActionPreference='Continue'; `$Host.UI.RawUI.WindowTitle='SCHOOL MANAGEMENT SYSTEM - API'; $backendCmd 2>&1 | Tee-Object -FilePath '$LogDir\backend.log'"
  if ($backendProc) { $backendProc.Id | Out-File -FilePath (Join-Path $LogDir "backend.pid") -Encoding ascii }
}

if ($webUp) {
  Write-Ok "Web portal already running" "port $FrontendPort"
} else {
  $webProc = Start-Process -FilePath "powershell" -WindowStyle Minimized -WorkingDirectory $FrontendDir -PassThru `
    -ArgumentList "-NoLogo", "-NoProfile", "-Command",
      "`$ErrorActionPreference='Continue'; `$Host.UI.RawUI.WindowTitle='SCHOOL MANAGEMENT SYSTEM - Web'; $frontendCmd 2>&1 | Tee-Object -FilePath '$LogDir\frontend.log'"
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
