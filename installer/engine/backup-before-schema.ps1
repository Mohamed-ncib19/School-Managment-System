# Safety dump taken immediately before a schema push.

# `drizzle-kit push` applies whatever it decides is needed WITHOUT asking.
# The update engine never passes --force anymore (a destructive change aborts
# the update instead), but even an additive push can fail half-way through a
# long ALTER on a school's live database. This dump is the rollback artifact
# for that worst case, taken while the servers are stopped and nothing is
# writing.

# It is a GATE, not a best-effort note: the dump must succeed and produce a
# verifiable artifact (exists, > 1 KB - a custom-format dump of a non-empty
# database is always at least a few KB) or the update aborts with exit 1. A
# school whose pg_dump is broken must not silently run schema changes with no
# rollback path. Support can bypass the gate in an emergency with
# SKIP_PRESCHEMA_GUARD=1 in apps\backend\.env - the skip is written to the
# result file and the log so it is never silent.

# Result contract (logs\pre-schema-result.json):
#   { "ok": true|false, "path": "backups\\pre-schema-<stamp>.dump"|null,
#     "sizeMB": number|null, "reason": string, "createdAt": iso8601 }
# The update engine reads `ok` and `path` from it. No result file + exit 0
# means "nothing to protect" (first run / empty database) - also safe.

# Usage:  .\backup-before-schema.ps1 -Root <repo root>

param(
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = "Continue"

function Write-Note($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }
function Write-Warn3($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

function Save-Result {
  param([bool]$Ok, [string]$Path, [object]$SizeMB, [string]$Reason)
  $logsDir = Join-Path $Root "logs"
  if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
  $payload = [ordered]@{
    ok        = $Ok
    path      = $Path
    sizeMB    = $SizeMB
    reason    = $Reason
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $json = $payload | ConvertTo-Json -Compress
  # Write atomically-ish: temp file then move, so the engine never reads half a file.
  $tmp = Join-Path $logsDir "pre-schema-result.json.tmp"
  $dst = Join-Path $logsDir "pre-schema-result.json"
  Set-Content -Path $tmp -Value $json -Encoding UTF8
  Move-Item -Path $tmp -Destination $dst -Force
  return $dst
}

function Finish-Fail {
  param([string]$Reason, [string]$Guidance)
  Write-Warn3 $Reason
  Save-Result -Ok $false -Path $null -SizeMB $null -Reason $Reason
  if ($env:SKIP_PRESCHEMA_GUARD -eq "1") {
    Write-Warn3 "SKIP_PRESCHEMA_GUARD=1 is set - continuing WITHOUT a safety backup (support override)."
    exit 0
  }
  if ($Guidance) { Write-Warn3 $Guidance }
  exit 1
}

$envFile = Join-Path $Root "apps\backend\.env"
if (-not (Test-Path $envFile)) {
  Write-Note "No apps\backend\.env yet - first run, nothing to protect."
  Save-Result -Ok $true -Path $null -SizeMB $null -Reason "no-env-first-run"
  exit 0
}

# DATABASE_URL=postgresql://user:pass@host:port/db
$line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+)$' | Select-Object -First 1
if (-not $line) {
  Write-Note "No DATABASE_URL in .env - nothing to protect."
  Save-Result -Ok $true -Path $null -SizeMB $null -Reason "no-database-url"
  exit 0
}
$url = $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")

try {
  $uri = [System.Uri]$url
} catch {
  Finish-Fail "DATABASE_URL is not a URL - cannot take the safety backup." "Fix apps\backend\.env, or set SKIP_PRESCHEMA_GUARD=1 there to update without the backup."
}
if ($uri.Scheme -ne "postgresql" -and $uri.Scheme -ne "postgres") {
  Finish-Fail "DATABASE_URL is not a PostgreSQL URL - cannot take the safety backup." "Fix apps\backend\.env, or set SKIP_PRESCHEMA_GUARD=1 there to update without the backup."
}

$userInfo = $uri.UserInfo.Split(":")
$dbUser = [System.Uri]::UnescapeDataString($userInfo[0])
$dbPass = if ($userInfo.Count -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$dbHost = $uri.Host
$dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$dbName = $uri.AbsolutePath.TrimStart("/").Split("?")[0]

if (-not $dbName -or $dbName -eq "public" -or $dbName -match '^\s*=') {
  Finish-Fail "Invalid database name ($dbName) - cannot take the safety backup." "Fix apps\backend\.env, or set SKIP_PRESCHEMA_GUARD=1 there to update without the backup."
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
  Finish-Fail "pg_dump not found - the update cannot run without a safety backup." "Install PostgreSQL client tools, or set SKIP_PRESCHEMA_GUARD=1 in apps\backend\.env to accept the risk."
}

# Skip when the database doesn't exist yet or is empty (first run).
if ($psqlBin) {
  $env:PGPASSWORD = $dbPass
  $tableCount = & $psqlBin -U $dbUser -h $dbHost -p $dbPort -w -d $dbName -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null
  $psqlCode = $LASTEXITCODE
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($psqlCode -ne 0) {
    Finish-Fail "Cannot reach the database '$dbName' to take the safety backup." "Start PostgreSQL and try the update again."
  }
  if (-not ($tableCount -match "^\d+$") -or [int]$tableCount -eq 0) {
    Write-Note "Database '$dbName' is empty or not initialized yet - safety backup skipped."
    Save-Result -Ok $true -Path $null -SizeMB $null -Reason "empty-database"
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
  if (Test-Path $target) { Remove-Item $target -Force -ErrorAction SilentlyContinue }
  Finish-Fail "The safety backup FAILED (pg_dump exit $code)." "The update stops here - nothing was changed. Check that PostgreSQL is running, then try the update again."
}

# Verify the artifact: a custom-format dump of a non-empty database is always
# at least a few KB. A tiny file means the dump silently produced nothing
# useful - treating it as a failure is the whole point of this gate.
$sizeBytes = (Get-Item $target).Length
if ($sizeBytes -lt 1024) {
  Remove-Item $target -Force -ErrorAction SilentlyContinue
  Finish-Fail "The safety backup produced a suspiciously small file ($sizeBytes bytes) - treating it as failed." "The update stops here - nothing was changed."
}

$sizeMB = [math]::Round($sizeBytes / 1MB, 1)
Write-Note "Saved backups\pre-schema-$stamp.dump ($sizeMB MB)"
Save-Result -Ok $true -Path "backups\pre-schema-$stamp.dump" -SizeMB $sizeMB -Reason "verified"

# Keep the five most recent; these are automatic and would otherwise pile up.
Get-ChildItem (Join-Path $backupDir "pre-schema-*.dump") -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 5 |
  Remove-Item -Force -ErrorAction SilentlyContinue

exit 0
