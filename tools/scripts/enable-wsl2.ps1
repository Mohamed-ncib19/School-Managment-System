<#
.SYNOPSIS
  Enable WSL2 + verify — must be run as Administrator.
#>
$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host ""
  Write-Host "  $msg" -ForegroundColor Cyan
  Write-Host ""
}

Write-Step "Enabling WSL2 (Admin)..."

$steps = @(
  @{ Name = "Microsoft-Windows-Subsystem-Linux"; Label = "Windows Subsystem for Linux" },
  @{ Name = "VirtualMachinePlatform";             Label = "Virtual Machine Platform" }
)

foreach ($step in $steps) {
  Write-Host "  Enabling $($step.Label)..." -ForegroundColor Yellow
  $output = dism.exe /online /enable-feature /featurename:$($step.Name) /all /norestart 2>&1
  $output | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK]  $($step.Label) enabled." -ForegroundColor Green
  } else {
    Write-Host "  [!!]  $($step.Label) failed (exit $LASTEXITCODE)" -ForegroundColor Red
    Write-Host $output
  }
}

Write-Host ""
Write-Host "  Checking wsl.exe location..." -ForegroundColor Yellow
$wslPath = Get-Command wsl.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if ($wslPath) {
  Write-Host "  [OK]  wsl.exe found at: $wslPath" -ForegroundColor Green
} else {
  Write-Host "  [!!]  wsl.exe NOT found in PATH. Checking System32..." -ForegroundColor Red
  $sysWsl = "C:\WINDOWS\system32\wsl.exe"
  if (Test-Path $sysWsl) {
    Write-Host "  [OK]  wsl.exe exists at $sysWsl (may need restart)" -ForegroundColor Green
  } else {
    Write-Host "  [!!]  wsl.exe missing from System32 entirely." -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "  IMPORTANT: You MUST restart your computer for WSL to work." -ForegroundColor Yellow
Write-Host "  After restart, open a NEW PowerShell and run:" -ForegroundColor Yellow
Write-Host "    wsl --install" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
