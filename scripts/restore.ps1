<#
  Restores the IQ Academy database from a backup produced by backup.ps1.

  This REPLACES the current contents of the database. It takes a safety dump
  of the present state first, so a mistaken restore is itself recoverable.
#>
[CmdletBinding()]
param(
  # Path to a .dump file. Omitted = pick from a list of available backups.
  [string]$Path
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BackendEnv = Join-Path $Root "apps\backend\.env"
$BackupDir = Join-Path $Root "backups"

function Get-EnvValue {
  param($EnvPath, $Key)
  if (-not (Test-Path $EnvPath)) { return $null }
  foreach ($line in Get-Content $EnvPath) {
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

if (-not $Path) {
  $dumps = Get-ChildItem (Join-Path $BackupDir "iq-academy-*.dump") -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending
  if (-not $dumps -or $dumps.Count -eq 0) { throw "No backups found in $BackupDir" }

  Write-Host "`nAvailable backups (newest first):`n" -ForegroundColor Cyan
  for ($i = 0; $i -lt $dumps.Count; $i++) {
    $d = $dumps[$i]
    $size = [math]::Round($d.Length / 1KB, 1)
    Write-Host ("  [{0}]  {1}   {2}   {3} KB" -f $i, $d.Name, $d.LastWriteTime, $size)
  }
  Write-Host ""
  $choice = Read-Host "Enter the number of the backup to restore (or press Enter to cancel)"
  if ([string]::IsNullOrWhiteSpace($choice)) { Write-Host "Cancelled." -ForegroundColor Yellow; exit 0 }
  $index = 0
  if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 0 -or $index -ge $dumps.Count) {
    throw "'$choice' isn't one of the listed numbers"
  }
  $Path = $dumps[$index].FullName
}

if (-not (Test-Path $Path)) { throw "Backup file not found: $Path" }

Write-Host "`n  About to REPLACE the contents of database '$dbName'" -ForegroundColor Yellow
Write-Host "  with: $(Split-Path -Leaf $Path)" -ForegroundColor Yellow
Write-Host "  Everything currently in the database will be overwritten.`n" -ForegroundColor Yellow
$confirm = Read-Host "Type RESTORE to continue"
if ($confirm -ne "RESTORE") { Write-Host "Cancelled." -ForegroundColor Yellow; exit 0 }

# Safety net: dump the current state before clobbering it.
Write-Host "`nTaking a safety backup of the current database first..." -ForegroundColor Cyan
try {
  & (Join-Path $PSScriptRoot "backup.ps1") -Quiet
  Write-Host "Safety backup saved to backups\" -ForegroundColor Green
} catch {
  Write-Host "Could not take a safety backup: $($_.Exception.Message)" -ForegroundColor Yellow
  $proceed = Read-Host "Continue with the restore anyway? (yes/no)"
  if ($proceed -ne "yes") { Write-Host "Cancelled." -ForegroundColor Yellow; exit 0 }
}

$pgRestore = $null
$portableRuntime = Join-Path $Root ".postgres\runtime"
if (Test-Path $portableRuntime) {
  $found = Get-ChildItem $portableRuntime -Filter "pg_restore.exe" -Recurse -ErrorAction SilentlyContinue |
           Select-Object -First 1
  if ($found) { $pgRestore = $found.FullName }
}
if (-not $pgRestore) {
  $cmd = Get-Command pg_restore -ErrorAction SilentlyContinue
  if ($cmd) { $pgRestore = $cmd.Source }
}
if (-not $pgRestore) {
  $candidate = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_restore.exe" -ErrorAction SilentlyContinue |
               Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidate) { $pgRestore = $candidate.FullName }
}
if (-not $pgRestore) { throw "pg_restore not found - run start.bat once to set PostgreSQL up." }

Write-Host "`nRestoring..." -ForegroundColor Cyan
$env:PGPASSWORD = $dbPass
try {
  # --clean --if-exists drops existing objects first so the restore is a true replace.
  & $pgRestore -U $dbUser -h $dbHost -p $dbPort -d $dbName --clean --if-exists --no-owner $Path
  # pg_restore returns non-zero for benign "does not exist" notices on --clean.
  if ($LASTEXITCODE -ne 0) {
    Write-Host "pg_restore finished with warnings (exit $LASTEXITCODE) - usually harmless with --clean." -ForegroundColor Yellow
  }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host "`nRestore complete. Restart the app with start.bat.`n" -ForegroundColor Green
