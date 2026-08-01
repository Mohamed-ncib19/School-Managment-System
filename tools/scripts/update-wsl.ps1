<#
.SYNOPSIS
  Update WSL kernel and verify. Run as Administrator.
#>
$ErrorActionPreference = "Stop"
$outFile = "D:\IQ Managment\tools\scripts\wsl-result2.txt"
if (Test-Path $outFile) { Remove-Item $outFile }

function Log($msg) { Add-Content -Path $outFile -Value $msg }

Log "=== WSL Kernel Update - $(Get-Date) ==="
Log ""

Log "[1] Running wsl --update..."
$r1 = wsl --update 2>&1 | Out-String
Log $r1
Log "Exit code: $LASTEXITCODE"
Log ""

Log "[2] Running wsl --version..."
$r2 = wsl --version 2>&1 | Out-String
Log $r2
Log "Exit code: $LASTEXITCODE"
Log ""

Log "[3] Checking wsl.exe..."
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
  Log "Found: $($wsl.Source)"
} else {
  Log "NOT FOUND"
}

Log ""
Log "=== DONE ==="
