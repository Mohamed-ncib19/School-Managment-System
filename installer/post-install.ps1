<#
  Runs once, from the installer, after the files are in place.

  The installer copies files; this turns them into a working system:
  prerequisites, the school's own configuration, dependencies and the
  database. It exists as a script rather than Inno Setup [Run] entries so the
  same sequence can be re-run by hand on a machine that half-installed —
  which is the situation a school actually calls about.

  Every step is idempotent. Running it twice changes nothing the second time.

  Exit codes: 0 = ready, 1 = the administrator cancelled, 2 = failed.
#>
[CmdletBinding()]
param(
  # Passed by the installer so this does not have to guess where it landed.
  [Parameter(Mandatory = $true)][string]$AppRoot,
  # Unattended installs skip the school-details dialog; the first launch of
  # the control panel asks instead.
  [switch]$Silent
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$EngineDir = Join-Path $AppRoot "installer\engine"
$LogDir = Join-Path $AppRoot "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir ("install-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

function Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Fail {
  param([string]$Message)
  Log "ÉCHEC : $Message"
  Log "Journal complet : $LogFile"
  exit 2
}

Log "Installation dans $AppRoot"

# --- 1. Node.js ------------------------------------------------------------
# Everything below needs it, and the error it produces otherwise ("'node' is
# not recognized") tells a school nothing about what to install.
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Log "Node.js absent — installation via winget…"
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Fail ("Node.js n'est pas installé et winget n'est pas disponible. " +
          "Installez Node.js 20 LTS depuis https://nodejs.org puis relancez l'installation.")
  }
  & winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>&1 |
    ForEach-Object { Log $_ }

  # winget updates PATH for new processes only; refresh it for this one.
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "Node.js a été installé mais reste introuvable. Redémarrez l'ordinateur puis relancez l'installation."
  }
}
Log "Node.js : $(& node --version)"

# --- 2. pnpm ---------------------------------------------------------------
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Log "Activation de pnpm via corepack…"
  & corepack enable 2>&1 | ForEach-Object { Log $_ }
  & corepack prepare pnpm@latest --activate 2>&1 | ForEach-Object { Log $_ }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Fail "pnpm n'a pas pu être activé. Vérifiez l'installation de Node.js."
}
Log "pnpm : $(& pnpm --version)"

# --- 3. School details -----------------------------------------------------
# The wizard writes apps\backend\.env and exits 0 when one already exists, so
# an upgrade never re-asks and never overwrites a school's configuration.
$setup = Join-Path $EngineDir "setup.ps1"
if (-not $Silent -and (Test-Path $setup)) {
  Log "Configuration de l'école…"
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $setup
  $code = $LASTEXITCODE
  if ($code -eq 1) {
    Log "Configuration annulée par l'utilisateur."
    exit 1
  }
  if ($code -ne 0) { Fail "La configuration de l'école a échoué (code $code)." }
} else {
  Log "Configuration différée au premier démarrage."
}

# --- 4. Dependencies -------------------------------------------------------
Log "Installation des dépendances (cela peut prendre plusieurs minutes)…"
Push-Location $AppRoot
try {
  & pnpm install 2>&1 | ForEach-Object { Log $_ }
  if ($LASTEXITCODE -ne 0) { Fail "L'installation des dépendances a échoué. Vérifiez la connexion internet." }
} finally {
  Pop-Location
}

Log "Installation terminée."
Log "Journal : $LogFile"
exit 0
