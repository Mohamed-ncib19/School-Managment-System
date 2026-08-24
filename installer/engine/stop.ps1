<#
  SCHOOL MANAGEMENT SYSTEM - stops the API and the web portal.

  Killing only the process that holds the port is not enough: the dev servers
  run under a watcher (nest --watch / next dev) that immediately restarts the
  child, so the system looks stopped and then comes back. This walks up to the
  watcher and kills the whole tree.

  PostgreSQL is deliberately left running by default - it holds the data, and
  it may be a shared Windows service. Nothing here touches the database.
  Pass -StopDatabase to also stop the project's own portable cluster under
  .postgres\ (the engine behind the in-app Shut Down button). A native server
  or a machine-wide service is never stopped.
#>
[CmdletBinding()]
param(
  [int[]]$Ports = @(3000, 3001),
  [switch]$StopDatabase
)

$ErrorActionPreference = "Continue"

<#
  Every process in the server tree - pnpm, the nest/next watcher, the cmd.exe
  shim, the server itself - carries the project directory in its command line,
  so that is what we match on. Matching on the command words instead is too
  brittle: the watcher reads 'nest.js" start --watch', which does not contain
  the literal 'nest start'.
#>
$ProjectRoot = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
$RootPattern = "*" + [System.Management.Automation.WildcardPattern]::Escape($ProjectRoot) + "*"
$LogDir      = Join-Path $ProjectRoot "logs"

# Only ever consider killing these. Anything else is somebody else's process.
$KillableNames = @('node.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'nest.exe', 'next.exe')

function Test-AppProcess {
  param($Proc)
  if (-not $Proc) { return $false }
  if ($KillableNames -notcontains $Proc.Name) { return $false }
  if (-not $Proc.CommandLine) { return $false }
  return ($Proc.CommandLine -like $RootPattern)
}

function Get-TreeRoot {
  <# Walks up from a PID while the ancestors still look like this app,
     and returns the highest one - the watcher to kill. #>
  param([int]$ProcessId)
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $current) { return $null }

  $root = $current
  $seen = @($current.ProcessId)

  while ($true) {
    $parentId = $root.ParentProcessId
    if (-not $parentId -or $parentId -eq 0 -or $seen -contains $parentId) { break }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
    if (-not (Test-AppProcess $parent)) { break }
    $root = $parent
    $seen += $parentId
  }
  return $root
}

<#
  Stops the project's own portable cluster (the one ensure-postgres.ps1 may
  have created under .postgres\). Native PostgreSQL installs and Windows
  services are somebody else's territory and are never touched here.
#>
function Stop-PortablePostgres {
  $root = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
  $dataDir = Join-Path $root ".postgres\data"
  if (-not (Test-Path (Join-Path $dataDir "PG_VERSION"))) { return $false }

  $pgCtl = Get-ChildItem (Join-Path $root ".postgres\runtime") -Filter "pg_ctl.exe" -Recurse -ErrorAction SilentlyContinue |
           Select-Object -First 1
  if (-not $pgCtl) { return $false }

  & $pgCtl.FullName -D $dataDir -m fast stop 2>&1 | Out-Null
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 500
    $conn = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) { return $true }
  }
  return $false
}

. (Join-Path $PSScriptRoot "ui.ps1")
Initialize-Ui -TotalSteps $Ports.Count

Clear-Host
Write-Banner -Title "SCHOOL MANAGEMENT SYSTEM" -Subtitle "Shutting down" -Colour DarkYellow

$stopped = 0
$labels = @{ 3000 = "Web portal"; 3001 = "API" }

foreach ($port in $Ports) {
  $name = if ($labels[$port]) { $labels[$port] } else { "Service" }
  Write-Step "$name  (port $port)"

  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
              Select-Object -First 1

  if (-not $listener) {
    Write-Info "Not running"
    continue
  }

  # Try the PID file first (faster and more precise than walking from the port).
  $pidFile = Join-Path $LogDir "$(if ($port -eq 3000) { 'frontend' } else { 'backend' }).pid"
  $targetId = $null
  if (Test-Path $pidFile) {
    $storedPid = Get-Content $pidFile -Raw -ErrorAction SilentlyContinue
    if ($storedPid -and (Get-Process -Id $storedPid -ErrorAction SilentlyContinue)) {
      $root = Get-TreeRoot -ProcessId $storedPid
      $targetId = if ($root) { $root.ProcessId } else { [int]$storedPid }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
  }

  # Fall back to port detection when no PID file or it is stale.
  if (-not $targetId) {
    $root = Get-TreeRoot -ProcessId $listener.OwningProcess
    $targetId = if ($root) { $root.ProcessId } else { $listener.OwningProcess }
  }

  # /T takes the children with it, which is what stops the respawn.
  & taskkill.exe /PID $targetId /T /F 2>&1 | Out-Null

  # Give the watcher a moment to die, then confirm the port is actually free.
  $freed = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 400
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
      $freed = $true
      break
    }
  }

  if (-not $freed) {
    # A survivor is still holding the port - take it out directly.
    $survivors = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $survivors) {
      & taskkill.exe /PID $conn.OwningProcess /T /F 2>&1 | Out-Null
    }
    Start-Sleep -Milliseconds 800
    $freed = -not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  }

  if ($freed) {
    Write-Ok "Stopped" "pid $targetId"
    $stopped++
  } else {
    Write-Warn2 "Port $port is still in use - close it from Task Manager"
  }
}

if ($stopped -gt 0) {
  $rows = @(
    "---",
    "Servers|$stopped stopped"
  )
  if ($StopDatabase) {
    $pgStopped = Stop-PortablePostgres
    if ($pgStopped) { $rows += @("Database|portable cluster stopped - restart from the desktop shortcut") }
    else { $rows += @("Database|left running (native install or already stopped)") }
  } else {
    $rows += @("Database|still running - your data is untouched")
  }
  $rows += @("Restart|open the desktop shortcut")
  Write-Panel -Title "SCHOOL MANAGEMENT SYSTEM STOPPED" -Colour DarkYellow -Note (Get-UiElapsed) -Rows $rows
} else {
  Write-Panel -Title "NOTHING WAS RUNNING" -Colour DarkGray -Icon none -Rows @(
    "---",
    "Start|open the desktop shortcut"
  )
}
