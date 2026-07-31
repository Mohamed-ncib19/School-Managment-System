<#
  Guarantees a running PostgreSQL for IQ Academy, in preference order:

    1. Something already listening on the port          -> use it
    2. A native PostgreSQL Windows service              -> start it
    3. A portable server under .postgres\               -> download, init, start

  Step 3 is what makes "clone onto an empty machine and run start.bat" work
  without an administrator, and without EnterpriseDB (whose downloads are
  blocked on some networks and by corporate proxies generally). The binaries
  are the complete PostgreSQL distribution published by theseus-rs, including
  the client tools (psql, pg_dump, pg_restore) that backup and restore need.

  Writes the directory containing psql/pg_dump to the pipeline as its result.
#>
[CmdletBinding()]
param(
  [int]$Port = 5432,
  [string]$Version = "16.14.0",
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = Split-Path -Parent $PSScriptRoot
$PgHome = Join-Path $Root ".postgres"
$RuntimeDir = Join-Path $PgHome "runtime"
$DataDir = Join-Path $PgHome "data"
$LogFile = Join-Path $PgHome "postgres.log"
$PwFile = Join-Path $PgHome ".superuser"

$SuperUser = "postgres"
$SuperPassword = "iq_academy_local"

function Say { param($Message, $Colour = "White") if (-not $Quiet) { Write-Host "    $Message" -ForegroundColor $Colour } }

<#
  Invoke-WebRequest silently truncates large downloads on some connections,
  so stream through WebClient instead and assert the byte count afterwards.
#>
function Get-RemoteFile {
  param([string]$Url, [string]$OutFile, [int]$Retries = 3)

  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    $client = New-Object System.Net.WebClient
    $client.Headers.Add("User-Agent", "iq-academy-launcher")
    try {
      $client.DownloadFile($Url, $OutFile)
    } catch {
      if ($attempt -eq $Retries) { throw "Download failed after $Retries attempts: $($_.Exception.Message)" }
      Say "Download attempt $attempt failed, retrying..." "Yellow"
      Start-Sleep -Seconds 3
      continue
    } finally {
      $client.Dispose()
    }

    # Confirm we got the whole file rather than a truncated stream.
    try {
      $head = [System.Net.WebRequest]::Create($Url)
      $head.Method = "HEAD"
      $head.UserAgent = "iq-academy-launcher"
      $expectedBytes = ([int64]($head.GetResponse().ContentLength))
      $head.GetResponse().Close()
    } catch {
      $expectedBytes = 0
    }

    $actualBytes = (Get-Item $OutFile).Length
    if ($expectedBytes -le 0 -or $actualBytes -eq $expectedBytes) { return }

    if ($attempt -eq $Retries) {
      throw "Download is incomplete ($actualBytes of $expectedBytes bytes) after $Retries attempts."
    }
    Say "Download truncated ($actualBytes/$expectedBytes bytes), retrying..." "Yellow"
    Start-Sleep -Seconds 3
  }
}

function Test-PgPort {
  param([int]$P)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $wait = $client.BeginConnect("127.0.0.1", $P, $null, $null)
    $ok = $wait.AsyncWaitHandle.WaitOne(1200, $false)
    if ($ok -and $client.Connected) { $client.Close(); return $true }
    $client.Close(); return $false
  } catch { return $false }
}

function Find-PgBin {
  # Portable install wins: it's the one this script controls.
  if (Test-Path $RuntimeDir) {
    $portable = Get-ChildItem $RuntimeDir -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1
    if ($portable) { return (Split-Path -Parent $portable.FullName) }
  }

  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return (Split-Path -Parent $cmd.Source) }

  $native = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
  if ($native) { return (Split-Path -Parent $native.FullName) }

  return $null
}

# --- 1. Already running? ---------------------------------------------------

if (Test-PgPort $Port) {
  Say "PostgreSQL already listening on port $Port" "Green"
  $bin = Find-PgBin
  if ($bin) { return $bin }
  return ""
}

# --- 2. Native Windows service --------------------------------------------

$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc) {
  Say "Starting Windows service $($svc.Name)..." "Yellow"
  try {
    if ($svc.Status -ne "Running") { Start-Service $svc.Name -ErrorAction Stop }
    for ($i = 0; $i -lt 20; $i++) {
      if (Test-PgPort $Port) { break }
      Start-Sleep -Milliseconds 500
    }
    if (Test-PgPort $Port) {
      Say "Service started" "Green"
      $bin = Find-PgBin
      if ($bin) { return $bin }
      return ""
    }
  } catch {
    Say "Could not start the service: $($_.Exception.Message)" "Yellow"
  }
}

# --- 3. Portable server ----------------------------------------------------

Say "No PostgreSQL found - setting up a private one under .postgres\" "Yellow"

New-Item -ItemType Directory -Force -Path $PgHome | Out-Null

$pgBin = Find-PgBin
if (-not $pgBin) {
  $base = "https://github.com/theseus-rs/postgresql-binaries/releases/download/$Version"
  $assetName = "postgresql-$Version-x86_64-pc-windows-msvc.zip"
  $zipPath = Join-Path $PgHome $assetName

  Say "Downloading PostgreSQL $Version (~44 MB)..." "Cyan"
  Get-RemoteFile -Url "$base/$assetName" -OutFile $zipPath

  # Verify the download before trusting it — this binary runs as a server.
  $checksumFile = "$zipPath.sha256"
  $expected = $null
  try {
    Get-RemoteFile -Url "$base/$assetName.sha256" -OutFile $checksumFile -Retries 2
    # The published file is CertUtil output: the hash sits on its own line.
    $text = Get-Content $checksumFile -Raw
    if ($text -match "(?m)^\s*([0-9a-fA-F]{64})\s*$") { $expected = $Matches[1].ToLower() }
    Remove-Item $checksumFile -Force -ErrorAction SilentlyContinue
  } catch {
    Say "Could not fetch the checksum (continuing): $($_.Exception.Message)" "Yellow"
  }

  if ($expected) {
    $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
      Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
      throw "Checksum mismatch - the download was corrupt or tampered with. Expected $expected, got $actual."
    }
    Say "Checksum verified" "Green"
  }

  Say "Extracting..." "Cyan"
  if (Test-Path $RuntimeDir) { Remove-Item $RuntimeDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $RuntimeDir -Force

  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

  $pgBin = Find-PgBin
  if (-not $pgBin) { throw "PostgreSQL was extracted but psql.exe could not be located under $RuntimeDir" }
  Say "PostgreSQL $Version installed" "Green"
}

$initdb = Join-Path $pgBin "initdb.exe"
$pgCtl = Join-Path $pgBin "pg_ctl.exe"

# --- initialise the data directory (first run only) ------------------------

if (-not (Test-Path (Join-Path $DataDir "PG_VERSION"))) {
  Say "Creating the database cluster..." "Cyan"
  if (Test-Path $DataDir) { Remove-Item $DataDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

  # initdb reads the superuser password from a file so it never hits the
  # command line (and therefore never the process list).
  Set-Content -Path $PwFile -Value $SuperPassword -NoNewline -Encoding ascii

  & $initdb -D $DataDir -U $SuperUser --auth=scram-sha-256 --pwfile=$PwFile --encoding=UTF8 |
    Out-File -FilePath $LogFile -Append -Encoding utf8
  $initOk = $LASTEXITCODE -eq 0

  Remove-Item $PwFile -Force -ErrorAction SilentlyContinue

  if (-not $initOk) { throw "initdb failed - see $LogFile" }
  Say "Cluster created" "Green"
}

# --- start it --------------------------------------------------------------

Say "Starting PostgreSQL on port $Port..." "Cyan"
# listen_addresses is pinned to loopback: this server is for this machine only.
& $pgCtl -D $DataDir -l $LogFile -o "-p $Port -c listen_addresses=127.0.0.1" -w start 2>&1 |
  Out-File -FilePath $LogFile -Append -Encoding utf8

for ($i = 0; $i -lt 30; $i++) {
  if (Test-PgPort $Port) { break }
  Start-Sleep -Milliseconds 500
}

if (-not (Test-PgPort $Port)) {
  throw "PostgreSQL did not start. See $LogFile for details."
}

Say "PostgreSQL is running" "Green"
return $pgBin
