<#
  Writes a timestamped, compressed dump of the IQ Academy database into backups\.
  Called automatically by the launcher on every start, and on demand via backup.bat.
#>
[CmdletBinding()]
param(
  # Suppress per-step chatter (used by the launcher).
  [switch]$Quiet,
  # How many dumps to keep before pruning the oldest.
  [int]$Keep = 30
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BackendEnv = Join-Path $Root "apps\backend\.env"
$BackupDir = Join-Path $Root "backups"

function Say { param($Message, $Colour = "White") if (-not $Quiet) { Write-Host $Message -ForegroundColor $Colour } }

function Get-EnvValue {
  param($Path, $Key)
  if (-not (Test-Path $Path)) { return $null }
  foreach ($line in Get-Content $Path) {
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.+)\s*$") { return $Matches[1].Trim() }
  }
  return $null
}

$databaseUrl = Get-EnvValue $BackendEnv "DATABASE_URL"
if (-not $databaseUrl) { throw "DATABASE_URL is missing from apps/backend/.env" }
if ($databaseUrl -notmatch "postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)") {
  throw "DATABASE_URL isn't a valid Postgres connection string"
}
$dbUser = $Matches[1]; $dbPass = $Matches[2]; $dbHost = $Matches[3]
$dbPort = [int]$Matches[4]; $dbName = $Matches[5]

# pg_dump ships with the server install. Prefer the portable runtime the
# launcher manages, then anything on PATH, then a native install.
$pgDump = $null
$portableRuntime = Join-Path $Root ".postgres\runtime"
if (Test-Path $portableRuntime) {
  $found = Get-ChildItem $portableRuntime -Filter "pg_dump.exe" -Recurse -ErrorAction SilentlyContinue |
           Select-Object -First 1
  if ($found) { $pgDump = $found.FullName }
}
if (-not $pgDump) {
  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($cmd) { $pgDump = $cmd.Source }
}
if (-not $pgDump) {
  $candidate = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
               Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidate) { $pgDump = $candidate.FullName }
}
if (-not $pgDump) { throw "pg_dump not found - run start.bat once to set PostgreSQL up." }

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $BackupDir "iq-academy-$stamp.dump"

Say "Backing up '$dbName' -> backups\iq-academy-$stamp.dump" "Cyan"

$env:PGPASSWORD = $dbPass
try {
  # -Fc = custom format: compressed, and restorable with pg_restore.
  & $pgDump -U $dbUser -h $dbHost -p $dbPort -d $dbName -Fc -f $target
  if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if (-not (Test-Path $target)) { throw "pg_dump reported success but produced no file" }

$sizeKb = [math]::Round((Get-Item $target).Length / 1KB, 1)
Say "Backup complete ($sizeKb KB)" "Green"

# Prune oldest dumps beyond the retention window.
$dumps = Get-ChildItem (Join-Path $BackupDir "iq-academy-*.dump") -ErrorAction SilentlyContinue |
         Sort-Object LastWriteTime -Descending
if ($dumps.Count -gt $Keep) {
  $stale = $dumps | Select-Object -Skip $Keep
  foreach ($file in $stale) {
    Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
    Say "Pruned old backup $($file.Name)" "DarkGray"
  }
}
