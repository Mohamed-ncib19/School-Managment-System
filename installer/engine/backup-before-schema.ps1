# Safety dump taken immediately before a schema push.
#
# `drizzle-kit push --force` applies whatever it decides is needed WITHOUT
# asking - including destructive statements. That is fine for the additive
# changes this project normally makes, but a column rename in schema.ts is
# indistinguishable from "drop the old column, create a new one", and --force
# will happily do exactly that to a school's live database. There is no undo.
#
# This script takes a pg_dump right before that happens, so the worst case is
# a restore instead of a loss. It is intentionally best-effort: a school whose
# pg_dump is missing must still be able to start the app, so a failure here
# warns loudly and lets the caller continue rather than blocking the only way
# in. The dump is a safety net, not a gate.
#
# Usage:  .\backup-before-schema.ps1 -Root <repo root>

param(
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = "Continue"

function Write-Note($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }
function Write-Warn3($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

$envFile = Join-Path $Root "apps\backend\.env"
if (-not (Test-Path $envFile)) {
  Write-Note "No apps\backend\.env yet - first run, nothing to protect."
  exit 0
}

# DATABASE_URL=postgresql://user:pass@host:port/db
$line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+)$' | Select-Object -First 1
if (-not $line) {
  Write-Note "No DATABASE_URL in .env - nothing to protect."
  exit 0
}
$url = $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")

try {
  $uri = [System.Uri]$url
} catch {
  Write-Warn3 "DATABASE_URL is not a URL - skipping the safety backup."
  exit 0
}
if ($uri.Scheme -ne "postgresql" -and $uri.Scheme -ne "postgres") {
  Write-Warn3 "DATABASE_URL is not a PostgreSQL URL - skipping the safety backup."
  exit 0
}

$userInfo = $uri.UserInfo.Split(":")
$dbUser = [System.Uri]::UnescapeDataString($userInfo[0])
$dbPass = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$dbHost = $uri.Host
$dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$dbName = $uri.AbsolutePath.TrimStart("/").Split("?")[0]

if (-not $dbName -or $dbName -eq "public" -or $dbName -match '^\s*=') {
  Write-Note "Invalid database name ($dbName) - skipping the safety backup."
  exit 0
}

# Prefer the runtime shipped with the app, then anything on PATH.
$pgDump = $null
$psqlBin = $null
$runtime = Join-Path $Root ".postgres\runtime"
if (Test-Path $runtime) {
  $found = Get-ChildItem -Path $runtime -Filter "pg_dump.exe" -Recurse -ErrorAction SilentlyContinue |
           Select-Object -First 1
  if ($found) { $pgDump = $found.FullName }
  $foundPsql = Get-ChildItem -Path $runtime -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue |
               Select-Object -First 1
  if ($foundPsql) { $psqlBin = $foundPsql.FullName }
}
if (-not $pgDump) {
  $onPath = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($onPath) { $pgDump = $onPath.Source }
}
if (-not $psqlBin) {
  $onPathPsql = Get-Command psql -ErrorAction SilentlyContinue
  if ($onPathPsql) { $psqlBin = $onPathPsql.Source }
}
if (-not $pgDump) {
  Write-Warn3 "pg_dump not found - continuing WITHOUT a safety backup."
  Write-Warn3 "If a schema change removes a column, that data cannot be recovered."
  exit 0
}

# Skip safety backup if database doesn't exist or is empty (0 tables)
if ($psqlBin) {
  $env:PGPASSWORD = $dbPass
  $tableCount = & $psqlBin -U $dbUser -h $dbHost -p $dbPort -d $dbName -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0 -or -not ($tableCount -match "^\d+$") -or [int]$tableCount -eq 0) {
    Write-Note "Database '$dbName' is empty or not initialized yet - safety backup skipped."
    exit 0
  }
}

$backupDir = Join-Path $Root "backups"
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $backupDir "pre-schema-$stamp.dump"

Write-Note "Safety backup before the schema sync..."
$env:PGPASSWORD = $dbPass
try {
  & $pgDump -U $dbUser -h $dbHost -p $dbPort -d $dbName --format=custom --no-owner --no-privileges -f $target 2>&1 | Out-Null
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ($code -ne 0 -or -not (Test-Path $target)) {
  Write-Warn3 "Safety backup failed - continuing anyway so the app can start."
  if (Test-Path $target) { Remove-Item $target -Force -ErrorAction SilentlyContinue }
  exit 0
}

$size = [math]::Round((Get-Item $target).Length / 1MB, 1)
Write-Note "Saved backups\pre-schema-$stamp.dump ($size MB)"

# Keep the five most recent; these are automatic and would otherwise pile up.
Get-ChildItem (Join-Path $backupDir "pre-schema-*.dump") -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 5 |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit 0
