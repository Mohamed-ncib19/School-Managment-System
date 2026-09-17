<#
  Recovers the PostgreSQL superuser password when PostgreSQL is installed.

  Order: stored .env value -> well-known defaults -> pg_hba trust (empty) ->
  trust-reset (elevated only, fully reverted). Prints NOTHING secret to the
  console; the answer goes to stdout (or -EmitFile) as a single line, which
  may legitimately be empty when loopback trust works.

  Exit codes: 0 = answer ready (possibly empty), 2 = no server to recover
  from, 3 = recovery needs elevation, 4 = failed. All diagnostics go to the
  console via Write-Host, never to stdout.
#>
[CmdletBinding()]
param(
  [int]$Port = 5432,
  [string]$EnvFile = "",
  [string]$EmitFile = ""
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function Emit-Password {
  param([string]$Password)
  if ($EmitFile) {
    Set-Content -Path $EmitFile -Value $Password -NoNewline -Encoding ascii
  } else {
    Write-Output $Password
  }
}

function Find-Psql {
  $native = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
  if ($native) { return $native.FullName }
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $dir = $PSScriptRoot
  for ($i = 0; $i -lt 6 -and $dir; $i++) {
    $probe = Join-Path $dir ".postgres\runtime"
    if (Test-Path $probe) {
      $found = Get-ChildItem $probe -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue |
               Select-Object -First 1
      if ($found) { return $found.FullName }
    }
    $dir = Split-Path -Parent $dir
  }
  return $null
}

function Test-SuperLogin {
  param([string]$Psql, [int]$P, [string]$Password)
  $env:PGPASSWORD = $Password
  & $Psql -U postgres -h 127.0.0.1 -p $P -w -d postgres -tAc "SELECT 1" 2>$null | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  return $ok
}

function Test-Port {
  param([int]$P)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $wait = $client.BeginConnect("127.0.0.1", $P, $null, $null)
    $ok = $wait.AsyncWaitHandle.WaitOne(1200, $false) -and $client.Connected
    $client.Close()
    return $ok
  } catch { return $false }
}

function Get-ServiceDataDir {
  $svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $svc) { return $null }
  $detail = Get-CimInstance Win32_Service -Filter "Name = '$($svc.Name)'" -ErrorAction SilentlyContinue
  if (-not $detail -or -not $detail.PathName) { return $null }
  $m = [regex]::Match($detail.PathName, '-D\s+"([^"]+)"')
  if (-not $m.Success) { $m = [regex]::Match($detail.PathName, '-D\s+(\S+)') }
  if (-not $m.Success) { return $null }
  return @{ Name = $svc.Name; DataDir = $m.Groups[1].Value }
}

function Test-LoopbackTrust {
  param([string]$DataDir)
  $conf = Join-Path $DataDir "postgresql.conf"
  $hba = Join-Path $DataDir "pg_hba.conf"
  if ((Test-Path $conf)) {
    $hm = Select-String -Path $conf -Pattern "^\s*hba_file\s*=\s*'([^']+)'" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($hm) { $hba = $hm.Matches[0].Groups[1].Value }
  }
  if (-not (Test-Path $hba)) { return $false }
  foreach ($line in Get-Content $hba) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith("#")) { continue }
    $parts = $t -split "\s+"
    if ($parts.Count -lt 5 -or $parts[0] -ne "host") { continue }
    if ($parts[1] -notin @("all", "postgres")) { continue }
    if ($parts[2] -notin @("all", "postgres")) { continue }
    if ($parts[3] -notmatch "^(127\.0\.0\.1/32|::1/128|samehost|samenet)$") { continue }
    return ($parts[4] -eq "trust")
  }
  return $false
}

function New-RandomPassword {
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  $sb = New-Object System.Text.StringBuilder
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $buf = New-Object byte[] 1
  for ($i = 0; $i -lt 24; $i++) {
    do { $rng.GetBytes($buf) } while ($buf[0] -ge 248)
    [void]$sb.Append($chars[$buf[0] % $chars.Length])
  }
  return $sb.ToString()
}

# --- 0. Locate psql ---------------------------------------------------------
$psql = Find-Psql
if (-not $psql) { exit 2 }

# --- 1. Stored + well-known passwords ---------------------------------------
$stored = $null
if ($EnvFile -and (Test-Path $EnvFile)) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match "^\s*POSTGRES_SUPERUSER_PASSWORD\s*=\s*(.+)\s*$") { $stored = $Matches[1].Trim(); break }
  }
}
foreach ($pw in @($stored, "iq_academy_local", "postgres", "") | Where-Object { $_ -ne $null } | Select-Object -Unique) {
  if (Test-SuperLogin -Psql $psql -P $Port -Password $pw) { Emit-Password -Password $pw; exit 0 }
}

# --- 2. Native service files -------------------------------------------------
$info = Get-ServiceDataDir
if (-not $info) { exit 2 }
if (Test-LoopbackTrust -DataDir $info.DataDir) {
  Write-Host "  Loopback trust detected - no superuser password needed." -ForegroundColor DarkGray
  Emit-Password -Password ""
  exit 0
}

# --- 3. Trust-reset needs elevation ------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { exit 3 }

try {
  $hba = Join-Path $info.DataDir "pg_hba.conf"
  if (-not (Test-Path $hba)) { exit 4 }
  $backup = "$hba.iq-bak"
  Copy-Item $hba $backup -Force -ErrorAction Stop
  try {
    $content = Get-Content $hba -Raw
    $relaxed = $content -replace '(?m)^(host\s+\S+\s+\S+\s+(?:127\.0\.0\.1/32|::1/128)\s+)\S+(\s*(?:#.*)?)$', '$1trust$2'
    if ($relaxed -eq $content) { exit 4 }
    Set-Content -Path $hba -Value $relaxed -Encoding ascii -NoNewline
    Restart-Service -Name $info.Name -Force -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Port -P $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    if (-not (Test-Port -P $Port)) { exit 4 }
    $fresh = if ($stored) { $stored } else { New-RandomPassword }
    $safe = $fresh -replace "'", "''"
    $sqlFile = [System.IO.Path]::GetTempFileName()
    Set-Content -Path $sqlFile -Value "ALTER USER postgres PASSWORD '$safe';" -Encoding ascii
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    & $psql -U postgres -h 127.0.0.1 -p $Port -w -d postgres -f $sqlFile 2>$null | Out-Null
    $alterCode = $LASTEXITCODE
    Remove-Item $sqlFile -Force -ErrorAction SilentlyContinue
    if ($alterCode -ne 0) { exit 4 }
    Copy-Item $backup $hba -Force -ErrorAction Stop
    Remove-Item $backup -Force -ErrorAction SilentlyContinue
    $backup = $null
    Restart-Service -Name $info.Name -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(90)
    while (-not (Test-Port -P $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    if (Test-SuperLogin -Psql $psql -P $Port -Password $fresh) {
      Write-Host "  Superuser password recovered and stored." -ForegroundColor Green
      Emit-Password -Password $fresh
      exit 0
    }
    exit 4
  } finally {
    if ($backup -and (Test-Path $backup)) {
      Copy-Item $backup (Join-Path $info.DataDir "pg_hba.conf") -Force -ErrorAction SilentlyContinue
      Remove-Item $backup -Force -ErrorAction SilentlyContinue
    }
  }
} catch { exit 4 }
