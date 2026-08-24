<#
  SCHOOL MANAGEMENT SYSTEM - Update engine (Windows).

  Replaces the old update.bat: the in-app "Update now" dialog launches this.

  The engine never runs the servers directly. It first checks which servers
  are actually active, stops them only if they are (watchers would otherwise
  hold locks on node_modules and the update would fail with EPERM), pulls and
  installs the new version, and finally restarts - if and only if - the servers
  that were running before the update. A system the operator had shut down
  stays shut down: the engine is only a restarter, never a starter.

  The window is visible on purpose: the whole flow is narrated with the shared
  step/progress UI (ui.ps1). The long steps - git pull and pnpm install - run
  in background jobs so the window keeps drawing instead of freezing, and
  native tool output is mirrored to logs\update-<timestamp>.log by the
  launcher in updates.service.ts.

  All data-safe: it never touches the database contents beyond the additive
  drizzle-kit push.

  Invoked detached by the backend: UpdateNow in the app -> this script.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root       = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
$BackendDir = Join-Path $Root "apps\backend"
$ScriptsDir = $PSScriptRoot

. (Join-Path $ScriptsDir "ui.ps1")
Initialize-Ui -TotalSteps 8
Set-UiProgressFile (Join-Path $Root "logs\update-progress.json")

function Fail {
  param([string]$Message)
  Write-Host ""
  Write-UiProgress -State "failed" -Label $Message
  Write-Panel -Title "UPDATE FAILED" -Colour Red -Icon fail -Note (Get-UiElapsed) -Rows @(
    $Message,
    "---",
    "Data|nothing was changed - no database writes were made",
    "Restart|close this window, then open the desktop shortcut"
  )
  Read-Host "  Press Enter to close"
  exit 1
}

function Test-Port {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $wait = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $wait.AsyncWaitHandle.WaitOne(1200, $false)
    if ($ok -and $client.Connected) { $client.Close(); return $true }
    $client.Close()
    return $false
  } catch { return $false }
}

<#
  Animated wait label for the update window. Unlike ui.ps1's Wait-For it
  writes to the host unconditionally: the engine runs with its stdout
  redirected to the log file, and Wait-For would sit there in complete
  silence. Write-Host output still lands on the visible console window.
#>
function Wait-Label {
  param(
    [scriptblock]$Condition,
    [string]$Label,
    [int]$TimeoutSec = 120
  )

  $frames = @([char]0x280B, [char]0x2819, [char]0x2839, [char]0x2838, [char]0x283C, [char]0x2834, [char]0x2826, [char]0x2827, [char]0x2807, [char]0x280F)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $i = 0

  while ((Get-Date) -lt $deadline) {
    if (& $Condition) {
      Write-Host ("`r" + (" " * ($Label.Length + 8)) + "`r") -NoNewline
      return $true
    }
    Write-Host ("`r{0}  {1}..." -f $frames[$i % $frames.Count], $Label) -ForegroundColor DarkGray -NoNewline
    $i++
    Start-Sleep -Milliseconds 250
  }
  Write-Host ("`r" + (" " * ($Label.Length + 8)) + "`r") -NoNewline
  return $false
}

<#
  Waits for a background job with the animated label, then reports success or
  fails the update. The job's buffered output is only dumped on failure, so
  the diagnosis is visible while a clean run stays tidy.
#>
function Wait-BackgroundJob {
  param(
    $Job,
    [string]$Label,
    [int]$TimeoutSec = 600,
    [string]$FailMessage
  )

  if (-not (Wait-Label -Condition { $Job.State -ne "Running" } -Label $Label -TimeoutSec $TimeoutSec)) {
    Stop-Job $Job -ErrorAction SilentlyContinue
    Remove-Job $Job -Force
    Fail "$FailMessage - it timed out."
  }
  if ($Job.State -eq "Failed") {
    $reason = $Job.ChildJobs[0].JobStateInfo.Reason.Message
    Receive-Job $Job -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Remove-Job $Job -Force
    Fail "$FailMessage - $reason"
  }
  Remove-Job $Job -Force
}

# The tracked release branch comes from UPDATE_BRANCH in apps/backend/.env
# (each school install pins the same branch, e.g. selfhosted) - otherwise
# selfhosted: every install updates from the same release branch, never main.
$Branch = "selfhosted"
$EnvFile = Join-Path $BackendDir ".env"
if (Test-Path $EnvFile) {
  $match = Select-String -Path $EnvFile -Pattern '^UPDATE_BRANCH=(.+)$' -ErrorAction SilentlyContinue
  if ($match) { $Branch = $match.Matches[0].Groups[1].Value.Trim() }
}

Clear-Host
Write-Banner -Title "SCHOOL MANAGEMENT SYSTEM" -Subtitle "Update  -  branch $Branch" -Colour Cyan

if (-not (Test-Path (Join-Path $Root ".git"))) { Fail "Not a git repository - update only works on a cloned install." }

# ---------------------------------------------------------------------------
# 1. Check which servers are actually running - this decides whether anything
#    gets stopped now and restarted at the end. Nothing is stopped blindly.
# ---------------------------------------------------------------------------
Write-Step "Checking the running servers"
$wasApiUp = Test-Port 3001
$wasWebUp = Test-Port 3000
if ($wasApiUp) { Write-Ok "API is running" "port 3001" } else { Write-Info "API not running (port 3001)" }
if ($wasWebUp) { Write-Ok "Web portal is running" "port 3000" } else { Write-Info "Web portal not running (port 3000)" }

# ---------------------------------------------------------------------------
# 2. Fetch + compare (read-only - the running servers can keep running)
# ---------------------------------------------------------------------------
Write-Step "Checking for updates"
Push-Location $Root
git fetch origin 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "git fetch failed - check the internet connection." }

$behind = (git rev-list HEAD..origin/$Branch --count 2>$null | Select-Object -Last 1)
if (-not $behind) { $behind = "0" }
$behind = $behind.Trim()
$headBefore = (git rev-parse --short HEAD 2>$null | Select-Object -Last 1).Trim()
Pop-Location

if ([int]$behind -le 0) {
  Write-Ok "Already on the latest version" "HEAD $headBefore"
  Write-Panel -Title "ALREADY UP TO DATE" -Colour Green -Note ("checked in " + (Get-UiElapsed)) -Rows @(
    "---",
    "Branch|origin/$Branch",
    "Installed|$headBefore",
    "---",
    "Servers|left exactly as they were - nothing was stopped"
  )
  exit 0
}
Write-Ok "New version found" "$behind new commit(s) on origin/$Branch"

# ---------------------------------------------------------------------------
# 3. Stop the servers - only if they were actually running. Watchers would
#    otherwise hold locks on node_modules and the update would fail with EPERM.
# ---------------------------------------------------------------------------
Write-Step "Stopping the running servers"
if (-not ($wasApiUp -or $wasWebUp)) {
  Write-Info "Nothing was running - skipping the shutdown."
} else {
  & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "stop.ps1") -Ports @(3000, 3001) | Out-Null

  Write-Host ""
  Write-Info "Waiting for ports 3000/3001 to release..."
  $stillBusy = $true
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 1
    $busy = Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { $stillBusy = $false; break }
  }
  if ($stillBusy) {
    Write-Warn2 "Ports 3000/3001 still in use - continuing; the launcher will reuse them."
  } else {
    Write-Ok "Servers stopped" "ports 3000/3001 released"
  }
}

# ---------------------------------------------------------------------------
# 4. Pull the new version in the background - the window keeps animating
# ---------------------------------------------------------------------------
Write-Step "Pulling the latest version"
Write-Info "git pull is running in the background..."
$pullJob = Start-Job -ScriptBlock {
  param($Dir, $Name)
  Set-Location $Dir
  git pull origin $Name 2>&1
  if ($LASTEXITCODE -ne 0) { throw "resolve the git conflict manually, then try the update again." }
} -ArgumentList $Root, $Branch
Wait-BackgroundJob -Job $pullJob -Label "Pulling from origin/$Branch" -TimeoutSec 300 -FailMessage "git pull failed"
Write-Ok "Latest version pulled" "$behind commit(s) applied"

# ---------------------------------------------------------------------------
# 5. Dependencies - also backgrounded, it is the slowest step
# ---------------------------------------------------------------------------
Write-Step "Syncing dependencies"
Write-Info "pnpm install is running in the background..."
$installJob = Start-Job -ScriptBlock {
  param($Dir)
  Set-Location $Dir
  pnpm install 2>&1
  if ($LASTEXITCODE -ne 0) { throw "see the dependency error above." }
} -ArgumentList $Root
Wait-BackgroundJob -Job $installJob -Label "Installing packages (pnpm)" -TimeoutSec 900 -FailMessage "pnpm install failed"
Write-Ok "Dependencies up to date"

# ---------------------------------------------------------------------------
# 6. Database schema (drizzle-kit push is idempotent and additive)
# ---------------------------------------------------------------------------
Write-Step "Syncing the database schema"
# An update is the likeliest moment for a schema change, and `push --force`
# never asks before dropping something. Dump first.
& (Join-Path $PSScriptRoot "backup-before-schema.ps1") -Root $Root

Push-Location $BackendDir
for ($attempt = 1; $attempt -le 5; $attempt++) {
  pnpm exec drizzle-kit push --force 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Write-Info "drizzle-kit push failed (attempt $attempt/5) - retrying..."
  Start-Sleep -Seconds 3
}
Pop-Location
if ($LASTEXITCODE -ne 0) { Fail "drizzle-kit push failed after 5 attempts." }
Write-Ok "Database schema is up to date"

# ---------------------------------------------------------------------------
# 7. Restart - only the servers that were running before the update. The
#    engine restarts, it never starts: a system that was shut down stays down.
# ---------------------------------------------------------------------------
Write-Step "Restarting the servers"
if ($wasApiUp -or $wasWebUp) {
  Write-Info "Restarting what was running before the update..."
  Start-Process "wscript.exe" -ArgumentList ("`"" + (Join-Path $Root "installer\runtime\start-servers.vbs") + "`"")
} else {
  Write-Info "No server was running before the update - not starting anything."
  Write-Info "Start it whenever you need it from the desktop shortcut."
}

Push-Location $Root
$head = (git rev-parse --short HEAD 2>$null | Select-Object -Last 1).Trim()
Pop-Location
if (-not $head) { $head = "?" }

Write-Panel -Title "UPDATE COMPLETE" -Colour Green -Note ("done in " + (Get-UiElapsed)) -Rows @(
  "---",
  "Commits applied|$behind",
  "Branch|origin/$Branch",
  "Now at|$head",
  "---",
  "Servers|$(if ($wasApiUp -or $wasWebUp) { 'restarting via the launcher' } else { 'were already shut down - not started' })",
  "Data|untouched - additive migrations only",
  "Log|logs\update-*.log"
)
Write-UiProgress -State "done" -Label "Update complete"
exit 0