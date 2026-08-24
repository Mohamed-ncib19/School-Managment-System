<#
  Guarantees a running PostgreSQL for SCHOOL MANAGEMENT SYSTEM, in preference order:

    1. Something already listening on the port              -> use it
    2. A native PostgreSQL Windows service                  -> start it
    3. No native install -> install PostgreSQL from the
       official EnterpriseDB installer into
       "C:\Program Files\PostgreSQL"  (silent, then interactive
       fallback that tells the user which password to type)
    4. Last resort, offline only: a private runtime under
       .postgres\ so the launcher still works on machines that
       cannot reach EnterpriseDB at all.

  The superuser password is never typed by the user: the first-run wizard
  generates it into apps\backend\.env, step 3 installs with that exact value,
  and the launcher then creates the application role/database with it.

  Writes the directory containing psql/pg_dump to the pipeline as its result.
#>
[CmdletBinding()]
param(
  [int]$Port = 5432,
  [string]$Version = "16.14.0",
  [switch]$Quiet,
  # Superuser password for a NEWLY initialised cluster. Existing clusters keep
  # the password they were created with - this value is never applied retroactively.
  [string]$SuperPassword = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
$PgHome = Join-Path $Root ".postgres"
$RuntimeDir = Join-Path $PgHome "runtime"
$DataDir = Join-Path $PgHome "data"
$LogFile = Join-Path $PgHome "postgres.log"
$PwFile = Join-Path $PgHome ".superuser"

$SuperUser = "postgres"
# The default is used only on machines that never ran the wizard (pre-wizard
# installs). The first-run wizard generates a random password and passes it in
# via -SuperPassword.
$SuperPassword = if ($SuperPassword) { $SuperPassword } else { "iq_academy_local" }

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

function Find-NativePgBin {
  $native = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
  if ($native) { return (Split-Path -Parent $native.FullName) }
  return $null
}

function Find-PgBin {
  # Native installs win: they are the ones this script prefers.
  $native = Find-NativePgBin
  if ($native) { return $native }

  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return (Split-Path -Parent $cmd.Source) }

  # Last resort, offline: the portable runtime under .pg\.
  if (Test-Path $RuntimeDir) {
    $portable = Get-ChildItem $RuntimeDir -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1
    if ($portable) { return (Split-Path -Parent $portable.FullName) }
  }

  return $null
}

function Wait-PgPortUp {
  param([int]$P, [int]$TimeoutSec, [string]$Label)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $waited = 0
  while (-not (Test-PgPort $P) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $waited += 5
    Say "  ... waiting for $Label ($waited s)..." "Cyan"
  }
  return (Test-PgPort $P)
}

<#
  Make sure the exact superuser password we install or initialise with is
  recorded in apps\backend\.env - the launcher reads it back from there to
  create the role and database afterwards.
#>
function Sync-SuperPasswordIntoEnv {
  param([string]$Password)
  $envFile = Join-Path (Join-Path (Join-Path $Root "apps") "backend") ".env"
  if (-not (Test-Path $envFile)) { return }
  $content = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
  if ($null -eq $content) { return }
  if ($content -match "(?m)^POSTGRES_SUPERUSER_PASSWORD\s*=.*$") {
    $content = $content -replace "(?m)^POSTGRES_SUPERUSER_PASSWORD\s*=.*$", "POSTGRES_SUPERUSER_PASSWORD=$Password"
  } else {
    $content = $content.TrimEnd() + "`r`nPOSTGRES_SUPERUSER_PASSWORD=$Password`r`n"
  }
  Set-Content -Path $envFile -Value $content -NoNewline -Encoding ascii
  Say "Recorded the superuser password in .env" "Green"
}

# --- 1. Already listening? ------------------------------------------------

if (Test-PgPort $Port) {
  Say "PostgreSQL already listening on port $Port" "Green"
  $bin = Find-PgBin
  if ($bin) { return $bin }
  return ""
}

# --- 2. Native Windows service present ------------------------------------
$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc) {
  Say "Starting Windows service $($svc.Name)..." "Yellow"
  try {
    if ($svc.Status -ne "Running") { Start-Service $svc.Name -ErrorAction Stop }
    if (Wait-PgPortUp -P $Port -TimeoutSec 20 -Label "the PostgreSQL service") {
      Say "Service started" "Green"
      $bin = Find-PgBin
      if ($bin) { return $bin }
      return ""
    }
  } catch {
    Say "Could not start the service: $($_.Exception.Message)" "Yellow"
  }
}

# --- 3. No native install: install from the official installer ------------
$nativeInstallAttempted = $false

if (-not (Find-NativePgBin)) {
  Say "PostgreSQL is not installed - downloading the official installer (~350 MB)..." "Cyan"

  $major = ($Version -split "\.")[0]
  $installer = Join-Path $env:TEMP "postgresql-$Version-1-windows-x64.exe"

  try {
    if (-not (Test-Path $installer)) {
      try {
        Get-RemoteFile -Url "https://get.enterprisedb.com/postgresql/postgresql-$Version-1-windows-x64.exe" -OutFile $installer -Retries 2
        Say "Installer downloaded" "Green"
      } catch {
        Say "Direct download refused: $($_.Exception.Message)" "Yellow"
        $installer = ""
      }
    } else {
      Say "Installer already downloaded" "Green"
    }

    # ---- browser-assisted download ---------------------------------------
    # Some networks/CDNs refuse automated downloads of the installer. Open
    # the official page in the browser, then watch Downloads for the file.
    if (-not $installer) {
      Sync-SuperPasswordIntoEnv -Password $SuperPassword
      Add-Type -AssemblyName System.Windows.Forms
      Set-Clipboard -Value $SuperPassword
      $prompt = "The automatic download of the PostgreSQL installer is blocked on this network.`n`n" +
                "Your browser is opening the official download page now.`n`n" +
                "1. Choose the Windows x86-64 installer and download it - do NOT run it.`n" +
                "2. The superuser password is handled automatically; it will be set to:`n`n" +
                "    $SuperPassword`n`n" +
                "(it is already on your clipboard - paste it anywhere with Ctrl+V)`n`n" +
                "This window will detect the file and continue on its own."
      [System.Windows.Forms.MessageBox]::Show($prompt, "SCHOOL MANAGEMENT SYSTEM - PostgreSQL", "OK", "Information") | Out-Null
      Start-Process "https://www.postgresql.org/download/windows/"

      $candidates = @(
        (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"),
        $env:TEMP,
        $Root
      )
      $deadline = (Get-Date).AddMinutes(15)
      $waitedFor = 0
      while (-not $installer -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $waitedFor += 10
        foreach ($dir in $candidates) {
          $hit = Get-ChildItem $dir -Filter "postgresql-*-windows*-x64.exe" -ErrorAction SilentlyContinue |
                 Where-Object { $_.Length -gt 100MB } |
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1
          if ($hit) { $installer = $hit.FullName; break }
        }
        if (-not $installer) {
          Say "  ... waiting for the installer in Downloads ($waitedFor s)..." "Cyan"
        }
      }
      if (-not $installer) {
        throw "The installer was not downloaded. Get it from https://www.postgresql.org/download/windows/, then start the system again from the desktop shortcut."
      }
      Say "Found the installer: $(Split-Path $installer -Leaf)" "Green"
    }

    # ---- silent install --------------------------------------------------
    # The CDN may serve a newer build than $Version - its major version is
    # what names the Windows service.
    $fileMajor = if ($installer -match "postgresql-(\d+)\.") { $Matches[1] } else { $major }
    $serviceName = "postgresql-x64-$fileMajor"

    Say "Installing PostgreSQL $fileMajor into C:\Program Files\PostgreSQL - allow the Windows permission prompt (UAC)..." "Blue"
    $nativeInstallAttempted = $true

    $installArgs = @(
      "--mode", "unattended",
      "--unattendedmodeui", "none",
      "--superpassword", $SuperPassword,
      "--serverport", "$Port",
      "--servicename", $serviceName,
      "--create-data-dir", "1",
      "--install-runtimes", "0"
    )
    $proc = Start-Process -FilePath $installer -ArgumentList $installArgs -Verb RunAs -PassThru
    try { $proc.WaitForExit(600000) } catch { }
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }

    if (-not (Find-NativePgBin)) {
      # ---- guided install -------------------------------------------------
      # The user drives the standard installer. Before it opens, show the exact
      # superuser password to type so the launcher can log in afterwards.
      Say "The silent install did not complete (exit code $($proc.ExitCode)) - opening the guided installer instead..." "Yellow"
      Sync-SuperPasswordIntoEnv -Password $SuperPassword
      Add-Type -AssemblyName System.Windows.Forms
      Set-Clipboard -Value $SuperPassword
      $prompt = "The automatic setup did not finish. The standard installer is opening now.`n`n" +
                "In the database password step, paste the superuser password (it is on your clipboard - Ctrl+V) or type it EXACTLY as:`n`n" +
                "    $SuperPassword`n`n" +
                "Keep the default port $Port. Finish the installer, then this window continues on its own."
      [System.Windows.Forms.MessageBox]::Show($prompt, "SCHOOL MANAGEMENT SYSTEM - PostgreSQL", "OK", "Information") | Out-Null

      try {
        Start-Process -FilePath $installer
      } catch {
        throw "Could not start the PostgreSQL installer. Download it from https://www.postgresql.org/download/windows/, run it, then start this launcher again."
      }
      $nativeInstallAttempted = $true
    }
  } catch {
    Say "The automatic install could not start: $($_.Exception.Message)" "Yellow"
    $nativeInstallAttempted = $false
  }
}

# --- wait for the native install to come up --------------------------------
if ($nativeInstallAttempted) {
  $svcAfter = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($svcAfter -and $svcAfter.Status -ne "Running") {
    Say "Starting the installed Windows service $($svcAfter.Name)..." "Yellow"
    try { Start-Service $svcAfter.Name -ErrorAction Stop } catch { Say "Could not start the service: $($_.Exception.Message)" "Yellow" }
  }
  if (Wait-PgPortUp -P $Port -TimeoutSec 600 -Label "the installer to finish") {
    Say "PostgreSQL is running" "Green"
    $bin = Find-PgBin
    if ($bin) { return $bin }
    return ""
  } else {
    throw "PostgreSQL could not be started after installation. Start the system again from the desktop shortcut, or install PostgreSQL 16 from https://www.postgresql.org/download/windows/."
  }
}

# --- 4. Offline fallback: the private portable server ------------------------

Say "Using the private PostgreSQL under .pg\ (offline fallback)..." "Yellow"
New-Item -ItemType Directory -Force -Path $PgHome | Out-Null

$pgBin = Find-PgBin
if (-not $pgBin) {
  $base = "https://github.com/theseus-rs/postgresql-binaries/releases/download/$Version"
  $assetName = "postgresql-$Version-x86_64-pc-windows-msvc.zip"
  $zipPath = Join-Path $PgHome $assetName

  Say "Downloading PostgreSQL $Version (~44 MB)..." "Cyan"
  Get-RemoteFile -Url "$base/$assetName" -OutFile $zipPath

  # Verify the download before trusting it - this binary runs as a server.
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

# --- recover from a previously failed start --------------------------------
<#
  The two problems seen on machines that tried-and-failed before:

  1. A postgres.exe left over from an earlier session (killed, or the folder
     was deleted while it ran) still holds the data directory. pg_ctl start
     would hang or fail on it. Only processes whose command line contains OUR
     data directory are touched - never another PostgreSQL on the machine.
  2. postmaster.pid from a crashed start claims the cluster is running.

  Fix both before the retry below.
#>
$stalePostgres = Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($DataDir) }
foreach ($proc in $stalePostgres) {
  Say "Stopping orphaned PostgreSQL (pid $($proc.ProcessId))..." "Yellow"
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500

$pidFile = Join-Path $DataDir "postmaster.pid"
if (Test-Path $pidFile) {
  $pidText = Get-Content $pidFile -TotalCount 1 -ErrorAction SilentlyContinue
  if (-not ($pidText -and (Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue))) {
    Say "Cleaning a stale postmaster.pid from an interrupted start..." "Yellow"
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

# --- start it --------------------------------------------------------------
# A read-only or still-locked log file (antivirus, a survivor of the last
# attempt) makes pg_ctl fail with "could not open log file ... Permission
# denied". Each attempt below therefore gets a fresh log path, and the real
# pg_ctl error is printed on every failure so the console never sits silent.
$LogBase = Split-Path -Parent $LogFile
$logUsed = $LogFile
$started = $false
$lastOutput = ""

for ($attempt = 1; $attempt -le 3 -and -not $started; $attempt++) {
  if ($attempt -gt 1) {
    $logUsed = Join-Path $LogBase ("postgres.{0}.log" -f (Get-Random -Minimum 1000 -Maximum 9999))
  }
  Remove-Item $logUsed -Force -ErrorAction SilentlyContinue

  $attemptStart = Get-Date
  Say "Starting PostgreSQL (attempt $attempt/3)..." "Cyan"
  # Capturing pg_ctl output through a PowerShell pipeline dead-locks on
  # Windows: the spawned postmaster inherits the pipe handles, so EOF never
  # comes even though pg_ctl has exited. Start-Process -Wait+Redirect waits
  # for the process exit only and writes to files instead.
  $ctlOut = Join-Path $LogBase ("pg-ctl-{0}.out" -f (Get-Random -Minimum 1000 -Maximum 9999))
  $ctlErr = Join-Path $LogBase ("pg-ctl-{0}.err" -f (Get-Random -Minimum 1000 -Maximum 9999))
  # listen_addresses is pinned to loopback: this server is for this machine.
  # Start-Process does not quote arguments - paths with spaces must carry
  # their own quotes, or pg_ctl receives a broken -D argument.
  $null = Start-Process -FilePath $pgCtl -Wait -NoNewWindow `
    -ArgumentList @('-D', ('"' + $DataDir + '"'), '-l', ('"' + $logUsed + '"'), '-o', '"-p ' + $Port + ' -c listen_addresses=127.0.0.1"', '-W', 'start') `
    -RedirectStandardOutput $ctlOut -RedirectStandardError $ctlErr
  $lastOutput = ((Get-Content $ctlOut -ErrorAction SilentlyContinue) + (Get-Content $ctlErr -ErrorAction SilentlyContinue)) -join "`n"
  Remove-Item $ctlOut, $ctlErr -Force -ErrorAction SilentlyContinue
  $lastOutput = $lastOutput.Trim()

  $deadline = (Get-Date).AddSeconds(150)
  while (-not $started -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $started = Test-PgPort $Port
    if (-not $started) {
      Say "  ... waiting for PostgreSQL to accept connections ($([int](Get-Date).Subtract($attemptStart).TotalSeconds) s)..." "Cyan"
    }
  }

  if (-not $started) {
    $lastLine = ($lastOutput -split "\r?\n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
    Say "Attempt $attempt failed - $lastLine" "Yellow"
    Start-Sleep -Seconds 1
  }
}

if (-not $started) {
  throw "PostgreSQL did not start. $lastOutput  (see $logUsed)"
}

# Portable fallback path only: make the password the launcher will need
# available in .env as well.
if (-not (Find-NativePgBin)) {
  Sync-SuperPasswordIntoEnv -Password $SuperPassword
}
Say "PostgreSQL is running" "Green"
return $pgBin