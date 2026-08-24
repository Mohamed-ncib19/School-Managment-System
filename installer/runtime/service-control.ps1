<#
  Service control for the desktop control panel.

  One place that knows how to answer "is it running?" and how to start, stop
  and restart the system. The control panel is a view over these functions and
  holds no logic of its own; the installer and the in-app shutdown button call
  the same engine scripts underneath.

  Dot-source this file, do not run it:
      . "$PSScriptRoot\service-control.ps1"
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# The web portal and the API. Both must be up for the system to be usable.
$script:WebPort = 3000
$script:ApiPort = 3001

function Get-AppRoot {
  <#
    The installed application root, found by walking up for the workspace
    marker rather than assuming a fixed depth — the control panel can be
    invoked from a shortcut whose working directory is anything at all.
  #>
  $dir = $PSScriptRoot
  for ($i = 0; $i -lt 8; $i++) {
    if (Test-Path (Join-Path $dir "pnpm-workspace.yaml")) { return $dir }
    $parent = Split-Path -Parent $dir
    if (-not $parent -or $parent -eq $dir) { break }
    $dir = $parent
  }
  # Fall back to two levels up (installer\runtime\ -> root), which is where
  # this file ships.
  return (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

$script:AppRoot = Get-AppRoot
$script:EngineDir = Join-Path $script:AppRoot "installer\engine"

function Get-PortListener {
  <# The PID listening on a port, or $null. #>
  param([int]$Port)
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
  } catch {
    # Get-NetTCPConnection is absent on very old builds; netstat is the floor.
    $line = netstat -ano -p TCP 2>$null | Where-Object { $_ -match ":$Port\s+.*LISTENING" } | Select-Object -First 1
    if ($line -and $line -match '(\d+)\s*$') { return [int]$Matches[1] }
  }
  return $null
}

function Test-OwnedByApp {
  <#
    Whether a listening process actually belongs to this installation.

    Another program on port 3000 is a conflict to report, not a server to
    stop — showing it as "running" would make the panel lie, and stopping it
    would be somebody else's outage.
  #>
  param([int]$ProcessId)
  if (-not $ProcessId) { return $false }
  try {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $proc -or -not $proc.CommandLine) { return $false }
    return $proc.CommandLine -like ("*" + $script:AppRoot + "*")
  } catch {
    return $false
  }
}

function Get-DatabaseStatus {
  <#
    Only the portable cluster under .postgres\ is ours to report on. A native
    PostgreSQL service belongs to the machine, and the control panel has no
    business claiming it or stopping it.
  #>
  $dataDir = Join-Path $script:AppRoot ".postgres\data"
  if (-not (Test-Path $dataDir)) {
    return [pscustomobject]@{ Name = "Base de données"; State = "external"; Detail = "Service PostgreSQL du système"; ProcessId = $null }
  }
  $pidFile = Join-Path $dataDir "postmaster.pid"
  if (Test-Path $pidFile) {
    $first = (Get-Content $pidFile -TotalCount 1 -ErrorAction SilentlyContinue)
    if ($first -and ($first -as [int])) {
      $running = Get-Process -Id ([int]$first) -ErrorAction SilentlyContinue
      if ($running) {
        return [pscustomobject]@{ Name = "Base de données"; State = "running"; Detail = "PostgreSQL intégré"; ProcessId = [int]$first }
      }
    }
  }
  return [pscustomobject]@{ Name = "Base de données"; State = "stopped"; Detail = "PostgreSQL intégré"; ProcessId = $null }
}

function Test-AppConfigured {
  <#
    Whether this installation has been through the school-details wizard.

    `apps\backend\.env` carrying a DATABASE_URL is the marker: it is written
    once and never regenerated, which is precisely what distinguishes "set up"
    from "files are present". The control panel needs the difference — a
    Start on an unconfigured install runs the wizard first, and saying so
    beforehand is better than a console window appearing unannounced.
  #>
  $envFile = Join-Path $script:AppRoot "apps\backend\.env"
  if (-not (Test-Path $envFile)) { return $false }
  $content = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
  return [bool]($content -match "DATABASE_URL\s*=")
}

function Get-SchoolName {
  <# The configured school's name, or $null when not configured yet. #>
  $envFile = Join-Path $script:AppRoot "apps\backend\.env"
  if (-not (Test-Path $envFile)) { return $null }
  $line = Select-String -Path $envFile -Pattern '^\s*SCHOOL_NAME\s*=\s*(.+)$' -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Get-ServiceStatus {
  <#
    One snapshot of everything the panel shows. Returns three rows plus an
    overall verdict, so the caller never has to re-derive "is the system up".
  #>
  $rows = @()

  foreach ($svc in @(
      @{ Name = "Portail web"; Port = $script:WebPort },
      @{ Name = "API";         Port = $script:ApiPort }
    )) {
    $listener = Get-PortListener -Port $svc.Port
    if (-not $listener) {
      $state = "stopped"; $detail = "Port $($svc.Port)"
    } elseif (Test-OwnedByApp -ProcessId $listener) {
      $state = "running"; $detail = "Port $($svc.Port) — PID $listener"
    } else {
      # Occupied by something else: a conflict, not our server.
      $state = "conflict"; $detail = "Port $($svc.Port) occupé par un autre programme (PID $listener)"
    }
    $rows += [pscustomobject]@{ Name = $svc.Name; State = $state; Detail = $detail; ProcessId = $listener }
  }

  $rows += Get-DatabaseStatus

  $servers = $rows | Where-Object { $_.Name -ne "Base de données" }
  $overall =
    if (($servers | Where-Object { $_.State -eq "conflict" })) { "conflict" }
    elseif (($servers | Where-Object { $_.State -eq "running" }).Count -eq $servers.Count) { "running" }
    elseif (($servers | Where-Object { $_.State -eq "running" })) { "partial" }
    else { "stopped" }

  return [pscustomobject]@{ Rows = $rows; Overall = $overall }
}

function Start-AppServices {
  <#
    Hands off to the launcher, which owns the real work: prerequisites,
    PostgreSQL, schema, build, then both servers. It runs in its own window
    so a first run — which can install Node and take minutes — stays visible
    instead of appearing to hang behind a silent panel.
  #>
  param([switch]$Production)

  $launcher = Join-Path $script:EngineDir "launcher.ps1"
  if (-not (Test-Path $launcher)) {
    throw "Moteur de démarrage introuvable : $launcher"
  }

  $psArgs = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$launcher`"")
  if ($Production) { $psArgs += "-Prod" }

  Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs -WorkingDirectory $script:AppRoot | Out-Null
}

function Stop-AppServices {
  <#
    Stops both servers and the portable database, and waits for the ports to
    actually release. Returning before that would let the panel redraw as
    "running" and make the button look broken.
  #>
  param([int]$TimeoutSeconds = 30)

  $stopper = Join-Path $script:EngineDir "stop.ps1"
  if (-not (Test-Path $stopper)) {
    throw "Moteur d'arrêt introuvable : $stopper"
  }

  Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$stopper`"", "-StopDatabase") `
    -WorkingDirectory $script:AppRoot -WindowStyle Hidden -Wait | Out-Null

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $web = Get-PortListener -Port $script:WebPort
    $api = Get-PortListener -Port $script:ApiPort
    if (-not $web -and -not $api) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

function Restart-AppServices {
  Stop-AppServices | Out-Null
  Start-Sleep -Seconds 2
  Start-AppServices
}

function Open-AppPortal {
  Start-Process "http://localhost:$($script:WebPort)" | Out-Null
}

function Get-SupportContacts {
  <#
    The same contacts the in-app "Signal un problème" dialog uses.

    Read straight from the database when it is up, because that is where a
    school's own support details live (Settings -> Contact support). When it
    is down — which is exactly when someone needs help most — fall back to the
    product defaults, which are the same literals the app falls back to.
  #>
  $fallback = [pscustomobject]@{
    Email    = "mohamedncib900@gmail.com"
    Phone    = "+216 55 518 492"
    WhatsApp = "21655518492"
    School   = "Système de gestion scolaire"
  }

  $envFile = Join-Path $script:AppRoot "apps\backend\.env"
  if (-not (Test-Path $envFile)) { return $fallback }

  $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+)$' -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if (-not $line) { return $fallback }

  try {
    $uri = [System.Uri]($line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'"))
    $psql = Get-ChildItem -Path (Join-Path $script:AppRoot ".postgres\runtime") -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1
    $psqlPath = if ($psql) { $psql.FullName } else { (Get-Command psql -ErrorAction SilentlyContinue).Source }
    if (-not $psqlPath) { return $fallback }

    $userInfo = $uri.UserInfo.Split(":")
    $env:PGPASSWORD = [System.Uri]::UnescapeDataString($userInfo[1])
    $row = & $psqlPath -U ([System.Uri]::UnescapeDataString($userInfo[0])) -h $uri.Host `
      -p $(if ($uri.Port -gt 0) { $uri.Port } else { 5432 }) `
      -d $uri.AbsolutePath.TrimStart("/").Split("?")[0] -tAc `
      "SELECT coalesce(support_email,'')||'|'||coalesce(support_phone,'')||'|'||coalesce(support_whatsapp,'')||'|'||coalesce(system_name,'') FROM system_settings WHERE singleton='global'" 2>$null
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

    if ($LASTEXITCODE -eq 0 -and $row) {
      $parts = ($row -join "").Trim().Split("|")
      return [pscustomobject]@{
        Email    = if ($parts[0]) { $parts[0] } else { $fallback.Email }
        Phone    = if ($parts.Count -gt 1 -and $parts[1]) { $parts[1] } else { $fallback.Phone }
        WhatsApp = if ($parts.Count -gt 2 -and $parts[2]) { ($parts[2] -replace '\D', '') } else { $fallback.WhatsApp }
        School   = if ($parts.Count -gt 3 -and $parts[3]) { $parts[3] } else { $fallback.School }
      }
    }
  } catch {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
  return $fallback
}
