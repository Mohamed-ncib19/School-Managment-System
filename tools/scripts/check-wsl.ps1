<#
.SYNOPSIS
  Check and report WSL feature state — must be run as Administrator.
  Writes results to a file for the parent process to read.
#>
$ErrorActionPreference = "Stop"
$outFile = "D:\IQ Managment\tools\scripts\wsl-check-result.txt"

$lines = @()
$lines += "=== WSL Feature Check ==="
$lines += ""

$features = @(
  "Microsoft-Windows-Subsystem-Linux",
  "VirtualMachinePlatform"
)

foreach ($f in $features) {
  $info = dism.exe /online /Get-FeatureInfo /FeatureName:$f 2>&1 | Out-String
  $state = "Unknown"
  if ($info -match "State\s*:\s*(\w+)") { $state = $Matches[1] }
  $lines += "$f : $state"
}

$lines += ""
$lines += "=== wsl.exe check ==="

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if ($wsl) {
  $lines += "Found: $($wsl.Source)"
  $lines += "Running wsl --version..."
  $output = & wsl.exe --version 2>&1 | Out-String
  $lines += $output
} else {
  $lines += "NOT found in PATH"
}

$lines | Out-File -FilePath $outFile -Encoding utf8
Write-Host "Done. Results written to $outFile"
Read-Host "Press Enter to close"
