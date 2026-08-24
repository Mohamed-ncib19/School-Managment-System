<#
  SCHOOL MANAGEMENT SYSTEM - machine binding (anti-copy protection).

  Identifies the physical machine this project folder is bound to, using the
  Windows-install MachineGuid (never moves with the files), hashed with SHA256,
  and stored in machine.lock at the project root.

  Actions:
    check   exit 0 = bound and matches this machine
            exit 1 = bound to a DIFFERENT machine (folder was copied)
            exit 2 = not bound yet (first run on this computer)
    bind    write machine.lock for this computer (idempotent; -Force overwrites)
    info    print the machine identifier and the lock state without changing anything

  Run it as its own process (powershell -File ... -Action check) so the exit
  code can be read by the caller.
#>

[CmdletBinding()]
param(
  [ValidateSet("check", "bind", "info")]
  [string]$Action = "check",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$Root = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
$LockFile = Join-Path $Root "machine.lock"

function Get-MachineGuid {
  # Primary: the Windows install ID - unique per computer, never travels with files.
  try {
    $guid = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid -ErrorAction SilentlyContinue).MachineGuid
    if ($guid) { return [string]$guid }
  } catch {}

  # Fallback: hardware-derived fingerprint.
  try {
    $cs = Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue
    $bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
    $disk = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty SerialNumber
    $parts = @($cs.UUID, $cs.IdentifyingNumber, $bios.SerialNumber, $disk, $env:COMPUTERNAME)
    $joined = ($parts | Where-Object { $_ } ) -join ":"
    if ($joined) { return $joined }
  } catch {}

  return $null
}

function Get-MachineIdHash {
  param([string]$Raw)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Raw)
  $hash = $sha.ComputeHash($bytes)
  return ([System.BitConverter]::ToString($hash) -replace "-", "").ToLowerInvariant()
}

function Format-ShortId {
  param([string]$Id)
  return (($Id.ToUpperInvariant() -replace '([0-9A-F]{4})', '$1-') -replace '-$', '')
}

# ---------------------------------------------------------------------------
$guid = Get-MachineGuid

if (-not $guid) {
  Write-Warning "Machine identifier unavailable (non-Windows or missing MachineGuid). Binding is skipped on this system."
  exit 0
}

$id = Get-MachineIdHash $guid

switch ($Action) {
  "info" {
    Write-Host "Machine ID  : $(Format-ShortId $id)"
    Write-Host "Machine.lock: $(if (Test-Path $LockFile) { 'present' } else { 'absent' })"
    if (Test-Path $LockFile) {
      $stored = (Get-Content $LockFile -Raw).Trim().ToLowerInvariant()
      if ($stored -eq $id) { Write-Host "Match       : YES (this computer)" -ForegroundColor Green }
      else                { Write-Host "Match       : NO (bound to another computer)" -ForegroundColor Red }
    }
    exit 0
  }

  "bind" {
    if ((Test-Path $LockFile) -and -not $Force) {
      Write-Host "machine.lock already exists - this project is already bound." -ForegroundColor Yellow
      exit 0
    }
    Set-Content -Path $LockFile -Value $id -NoNewline -Encoding ASCII
    Write-Host "Bound: this computer is now licensed. (machine.lock created)" -ForegroundColor Green
    exit 0
  }

  "check" {
    if (-not (Test-Path $LockFile)) { exit 2 }  # first run here, not bound yet

    $stored = (Get-Content $LockFile -Raw).Trim().ToLowerInvariant()
    if ($stored -eq $id) { exit 0 }             # match - licensed computer
    exit 1                                      # bound to a different computer
  }
}