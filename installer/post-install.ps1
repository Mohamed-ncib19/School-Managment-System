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

function Invoke-Native {
  <#
    Runs an external program, logs everything it prints, and returns its exit
    code.

    The redirection is why this helper exists. In Windows PowerShell 5.1 a
    line a native program writes to stderr becomes an ErrorRecord once `2>&1`
    merges it into the pipeline, and under $ErrorActionPreference = "Stop"
    that ErrorRecord is a terminating error. pnpm and winget both write
    ordinary progress and deprecation notices to stderr, so leaving the
    preference at "Stop" turns a completely normal install into an unhandled
    NativeCommandError - the installation dies at "Installation des
    dependances" and the school never learns why.

    Lowering the preference for the duration is the fix. Success is decided by
    the exit code, never by $? and never by whether anything reached stderr.
  #>
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @()
  )
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Exe @Arguments 2>&1 | ForEach-Object {
      $text = "$_".TrimEnd()
      if ($text) { Log $text }
    }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

Log "Installation dans $AppRoot"

# --- 0. Already configured? ------------------------------------------------
# `apps\backend\.env` with a DATABASE_URL is the marker: it is written once by
# the school-details wizard and never regenerated. Saying so plainly is the
# point — a re-run that looked identical to a first install is exactly how
# someone ends up unsure whether their data survived.
$BackendEnv = Join-Path $AppRoot "apps\backend\.env"
$AlreadyConfigured = (Test-Path $BackendEnv) -and
                     ((Get-Content $BackendEnv -Raw -ErrorAction SilentlyContinue) -match "DATABASE_URL\s*=")

if ($AlreadyConfigured) {
  $schoolLine = Select-String -Path $BackendEnv -Pattern '^\s*SCHOOL_NAME\s*=\s*(.+)$' -ErrorAction SilentlyContinue |
                Select-Object -First 1
  $school = if ($schoolLine) { $schoolLine.Matches[0].Groups[1].Value.Trim().Trim('"') } else { "(nom inconnu)" }
  Log "Système déjà installé et configuré pour : $school"
  Log "La configuration existante est conservée — aucune donnée n'est touchée."
  Log "Seuls les fichiers du programme et les dépendances sont mis à jour."
} else {
  Log "Aucune installation précédente détectée — installation complète."
}

# --- 0b. Make the folder writable by whoever runs the system ---------------
# Everything this application does at runtime writes inside its own folder:
# apps\backend\.env, logs\, backups\, .postgres\data\, the Next.js build
# output and node_modules. The control panel that drives all of it is opened
# from a desktop shortcut, so it runs with the ordinary user's token - while
# this script runs elevated. Without the grant below, the shortcut opens a
# window whose Start button fails with "access denied" every time.
#
# Elevating the control panel instead is not an option: PostgreSQL refuses to
# run under an account holding administrative rights, so the database has to
# start unprivileged and needs a data directory it can write.
#
# S-1-5-32-545 is the well-known SID of the local Users group. Its NAME is
# translated on non-English Windows ("Utilisateurs" on the French installs
# this product targets) and icacls matches the literal string it is given, so
# the SID is the only spelling that works on every machine.
#
# (OI)(CI) makes the grant inheritable, which is what covers node_modules and
# .postgres\data - both created after this point, by other processes.
Log "Attribution des droits d'ecriture sur $AppRoot au groupe Utilisateurs..."
$aclCode = Invoke-Native -Exe "icacls.exe" -Arguments @(
  $AppRoot, "/grant", "*S-1-5-32-545:(OI)(CI)M", "/T", "/C", "/Q"
)
if ($aclCode -ne 0) {
  Fail ("Impossible d'accorder les droits d'ecriture sur $AppRoot (code $aclCode). " +
        "Sans ces droits, le raccourci du bureau ouvrirait un panneau incapable " +
        "de demarrer le systeme.")
}

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
  Invoke-Native -Exe "winget" -Arguments @(
    "install", "--id", "OpenJS.NodeJS.LTS", "--silent",
    "--accept-package-agreements", "--accept-source-agreements"
  ) | Out-Null

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
  Invoke-Native -Exe "corepack" -Arguments @("enable") | Out-Null
  Invoke-Native -Exe "corepack" -Arguments @("prepare", "pnpm@latest", "--activate") | Out-Null
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Fail "pnpm n'a pas pu être activé. Vérifiez l'installation de Node.js."
}
Log "pnpm : $(& pnpm --version)"

# --- 3. School details -----------------------------------------------------
# The wizard writes apps\backend\.env and exits 0 when one already exists, so
# an upgrade never re-asks and never overwrites a school's configuration.
$setup = Join-Path $EngineDir "setup.ps1"
if ($AlreadyConfigured) {
  Log "Configuration de l'école : déjà faite, ignorée."
} elseif (-not $Silent -and (Test-Path $setup)) {
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
  $installCode = Invoke-Native -Exe "pnpm" -Arguments @("install")
  if ($installCode -ne 0) { Fail "L'installation des dépendances a échoué. Vérifiez la connexion internet." }
} finally {
  Pop-Location
}

# --- 4b. Link version control when possible ----------------------------------
# Setup-installed copies ship without .git (the installer excludes it), which
# disables both the in-app updater and the launcher's self-update - both need
# a clone. When git exists and the release branch is reachable WITHOUT an
# interactive login, clone it shallowly into a temp dir and keep only the
# .git metadata, so this machine updates itself from now on. Anything missing
# (no git, offline, private repo without cached credentials) skips silently:
# the install works exactly as before, it just updates via the next Setup.exe.
try {
  $hasGitDir = Test-Path (Join-Path $AppRoot ".git")
  $gitCmd = Get-Command git -ErrorAction SilentlyContinue
  if (-not $hasGitDir -and $gitCmd) {
    $env:GIT_TERMINAL_PROMPT = "0"
    $tmpClone = Join-Path $env:TEMP ("iq-git-" + [Guid]::NewGuid().ToString("N"))
    # Same release repository the updater polls (see updates.service.ts).
    $remote = "https://github.com/Mohamed-ncib19/School-Managment-System.git"
    & git clone --quiet --depth 1 --branch selfhosted --no-checkout $remote $tmpClone 2>$null | Out-Null
    if (($LASTEXITCODE -eq 0) -and (Test-Path (Join-Path $tmpClone ".git"))) {
      Move-Item (Join-Path $tmpClone ".git") (Join-Path $AppRoot ".git") -Force
      Push-Location $AppRoot
      try { & git reset --quiet 2>$null | Out-Null } finally { Pop-Location }
      Log "Version control linked - future updates arrive inside the app."
    }
    Remove-Item $tmpClone -Recurse -Force -ErrorAction SilentlyContinue
  }
} catch { }

Log "Installation terminée."
Log "Journal : $LogFile"
exit 0
