<#
.SYNOPSIS
  One-shot WSL2 enable + install. Run as Administrator.
  Writes a result file the parent can read.
#>
$ErrorActionPreference = "Stop"
$outFile = "D:\IQ Managment\tools\scripts\wsl-result.txt"

function Log($msg) { Add-Content -Path $outFile -Value $msg }

if (Test-Path $outFile) { Remove-Item $outFile }

Log "=== WSL2 Setup - $(Get-Date) ==="
Log ""

Log "[1] Enabling Microsoft-Windows-Subsystem-Linux..."
$r1 = dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart 2>&1 | Out-String
Log $r1
Log "Exit code: $LASTEXITCODE"
Log ""

Log "[2] Enabling VirtualMachinePlatform..."
$r2 = dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart 2>&1 | Out-String
Log $r2
Log "Exit code: $LASTEXITCODE"
Log ""

Log "[3] Running wsl --install --no-distribution..."
$r3 = wsl --install --no-distribution 2>&1 | Out-String
Log $r3
Log "Exit code: $LASTEXITCODE"
Log ""

Log "[4] Verifying wsl.exe..."
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
  Log "wsl.exe found at: $($wsl.Source)"
  $ver = & wsl.exe --version 2>&1 | Out-String
  Log "Version output: $ver"
} else {
  Log "wsl.exe NOT FOUND"
}

Log ""
Log "=== DONE ==="
Log "RESTART REQUIRED: $(-not (Test-Port 3001))"
