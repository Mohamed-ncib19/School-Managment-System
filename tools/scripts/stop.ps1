<#
  IQ Academy - stops the API and the web portal.

  Killing only the process that holds the port is not enough: the dev servers
  run under a watcher (nest --watch / next dev) that immediately restarts the
  child, so the system looks stopped and then comes back. This walks up to the
  watcher and kills the whole tree.

  PostgreSQL is deliberately left running - it holds the data, and it is a
  shared Windows service. Nothing here touches the database.
#>
[CmdletBinding()]
param(
  [int[]]$Ports = @(3000, 3001)
)

$ErrorActionPreference = "Continue"

<#
  Every process in the server tree - pnpm, the nest/next watcher, the cmd.exe
  shim, the server itself - carries the project directory in its command line,
  so that is what we match on. Matching on the command words instead is too
  brittle: the watcher reads 'nest.js" start --watch', which does not contain
  the literal 'nest start'.
#>
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$RootPattern = "*" + [System.Management.Automation.WildcardPattern]::Escape($ProjectRoot) + "*"

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

. (Join-Path $PSScriptRoot "ui.ps1")
Initialize-Ui -TotalSteps $Ports.Count

Clear-Host
Write-Banner -Title "IQ ACADEMY" -Subtitle "Shutting down" -Colour DarkYellow

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

  $root = Get-TreeRoot -ProcessId $listener.OwningProcess
  $targetId = if ($root) { $root.ProcessId } else { $listener.OwningProcess }

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
  Write-Panel -Title "IQ ACADEMY STOPPED" -Colour DarkYellow -Note (Get-UiElapsed) -Rows @(
    "---",
    "Servers|$stopped stopped",
    "Database|still running - your data is untouched",
    "Restart|tools\start.bat"
  )
} else {
  Write-Panel -Title "NOTHING WAS RUNNING" -Colour DarkGray -Icon none -Rows @(
    "---",
    "Start|tools\start.bat"
  )
}
