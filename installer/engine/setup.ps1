<#
  IQ School Manager - first-run setup wizard.

  Runs only when apps\backend\.env does not exist yet (brand-new installation).
  Opens a small native dialog asking for the school name, the manager's email
  and the admin password, then generates everything else AS VARIABLES derived
  from that name - nothing academy-specific is hard-coded:

    SCHOOL_NAME        as typed
    SCHOOL_SLUG        lowercase identifier (used for DB name, DB user, email)
    DB_NAME            e.g. noor_school
    DB_USER            e.g. noor_school_user
    DB_PASSWORD        random 24-char alphanumeric (safe for URLs and SQL)
    SUPER_PASSWORD     recovered automatically when PostgreSQL exists, else random 24-char
    JWT_SECRET         random
    JWT_REFRESH_SECRET random
    API_KEY            random 32-char alphanumeric (install API key, x-api-key)
    SEED_ADMIN_*       email + password typed in the dialog

  The values are written to apps\backend\.env and apps\frontend\.env.local
  (both git-ignored). It never touches an existing .env: existing
  installations keep their current configuration untouched.

  Exit codes: 0 = configured, 1 = user cancelled, 2 = error.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root = $(
  $__r = $PSScriptRoot
  while ($__r -and -not (Test-Path (Join-Path $__r 'pnpm-workspace.yaml'))) {
    $__p = Split-Path -Parent $__r
    if (-not $__p -or $__p -eq $__r) { break }
    $__r = $__p
  }
  $__r
)
$BackendDir  = Join-Path $Root "apps\backend"
$FrontendDir = Join-Path $Root "apps\frontend"
$BackendEnv  = Join-Path $BackendDir ".env"
$FrontendEnv = Join-Path $FrontendDir ".env.local"

# --- already configured? leave everything alone ----------------------------
if (Test-Path $BackendEnv) {
  $existing = Get-Content $BackendEnv -Raw
  if ($existing -match "DATABASE_URL\s*=") { Write-Host "Set-up already present - nothing to do."; exit 0 }
}

# --- helpers ------------------------------------------------------------------
function New-RandomString {
  param([int]$Length = 24)
  $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  $sb = New-Object System.Text.StringBuilder
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $buf = New-Object byte[] 1
  for ($i = 0; $i -lt $Length; $i++) {
    do { $rng.GetBytes($buf) } while ($buf[0] -ge 248)
    [void]$sb.Append($chars[$buf[0] % $chars.Length])
  }
  return $sb.ToString()
}

function ConvertTo-Slug {
  param([string]$Name)
  $slug = $Name.ToLowerInvariant() -replace "[^a-z0-9]+", "_"
  $slug = $slug.Trim("_")
  if (-not $slug) { $slug = "school_db" }
  return $slug
}

<#
  Recovers the existing PostgreSQL superuser password via
  get-superpassword.ps1 so setup reuses the real one. Returns the password
  (possibly empty when loopback trust works), or $null when nothing was
  found and a fresh password must be generated. Opens ONE administrator
  window only when a trust-reset is the way through; everything else runs
  silently in this console.
#>
function Get-RecoveredSuperPassword {
  param([int]$Port)
  $worker = Join-Path $PSScriptRoot "get-superpassword.ps1"
  if (-not (Test-Path $worker)) { return $null }
  $tmp = Join-Path $env:TEMP ("iq-superpw-" + [Guid]::NewGuid().ToString("N") + ".txt")
  try {
    & powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $worker -Port $Port -EmitFile $tmp | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $tmp)) {
      $v = Get-Content $tmp -Raw -ErrorAction SilentlyContinue
      if ($null -eq $v) { $v = "" }
      return $v.Trim()
    }
    if ($LASTEXITCODE -eq 3) {
      Write-Host "  Requesting administrator rights once to recover the database password..." -ForegroundColor Cyan
      $wArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$worker`" -Port $Port -EmitFile `"$tmp`""
      $proc = Start-Process powershell -Verb RunAs -ArgumentList $wArgs -Wait -PassThru -ErrorAction SilentlyContinue
      if ($proc -and $proc.ExitCode -eq 0 -and (Test-Path $tmp)) {
        $v = Get-Content $tmp -Raw -ErrorAction SilentlyContinue
        if ($null -eq $v) { $v = "" }
        return $v.Trim()
      }
    }
    return $null
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

function New-WizardDialog {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $form = New-Object System.Windows.Forms.Form
  $form.Text = "School Setup - First Run"
  $form.Width = 460
  $form.Height = 290
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.StartPosition = "CenterScreen"
  $form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

  function Add-Label {
    param([string]$Text, [int]$Top)
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $Text
    $l.Location = New-Object System.Drawing.Point(24, $Top)
    $l.Size = New-Object System.Drawing.Size(140, 20)
    $form.Controls.Add($l)
  }

  function Add-Input {
    param([int]$Top, [switch]$Secret)
    $i = New-Object System.Windows.Forms.TextBox
    $i.Location = New-Object System.Drawing.Point(170, $Top)
    $i.Size = New-Object System.Drawing.Size(250, 24)
    if ($Secret) { $i.UseSystemPasswordChar = $true }
    $form.Controls.Add($i)
    return $i
  }

  Add-Label "School name" 35
  $txtName = Add-Input 33
  Add-Label "Admin email" 75
  $txtEmail = Add-Input 73
  Add-Label "Admin password" 115
  $txtPassword = Add-Input 113 -Secret

  $btnOk = New-Object System.Windows.Forms.Button
  $btnOk.Text = "Configure"
  $btnOk.Location = New-Object System.Drawing.Point(170, 180)
  $btnOk.Size = New-Object System.Drawing.Size(120, 30)
  $btnOk.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
  $form.AcceptButton = $btnOk

  $btnCancel = New-Object System.Windows.Forms.Button
  $btnCancel.Text = "Cancel"
  $btnCancel.Location = New-Object System.Drawing.Point(300, 180)
  $btnCancel.Size = New-Object System.Drawing.Size(120, 30)
  $btnCancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
  $form.CancelButton = $btnCancel

  $form.Controls.Add($btnOk)
  $form.Controls.Add($btnCancel)

  Write-Host "  Waiting for the setup window - enter the school details and click OK." -ForegroundColor Cyan

  while ($true) {
    $form.ShowDialog() | Out-Null
    if ($form.DialogResult -ne [System.Windows.Forms.DialogResult]::OK) { return $null }

    $name = $txtName.Text.Trim()
    $email = $txtEmail.Text.Trim()
    $password = $txtPassword.Text

    if (-not $name) {
      [System.Windows.Forms.MessageBox]::Show("Please enter the school name.", "School Setup", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
      continue
    }
    if ($password.Length -lt 8) {
      [System.Windows.Forms.MessageBox]::Show("The admin password must be at least 8 characters.", "School Setup", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
      continue
    }

    if (-not $email) { $email = "admin@$(ConvertTo-Slug $name).com" }
    return @{ Name = $name; Slug = (ConvertTo-Slug $name); Email = $email; Password = $password }
  }
}

$values = New-WizardDialog
if (-not $values) { Write-Host "  Setup cancelled - nothing was changed." -ForegroundColor Yellow; exit 1 }

$slug = $values.Slug
$dbName = $slug
# Belt and braces: only plain slug characters may enter a URL part and an
# SQL identifier - anything else would make DATABASE_URL unparseable.
if ($dbName -notmatch '^[a-z0-9_-]+$') { $dbName = "school_db" }
$dbUser = "$($dbName)_user"
$dbPassword = New-RandomString 24
# The superuser password is recovered, not always generated: when PostgreSQL
# is already installed, get-superpassword.ps1 finds the working password
# (stored value, defaults, loopback trust) so the installer reuses the real
# one instead of inventing a password that matches nothing. A single
# administrator window opens only when a trust-reset is the way through.
$superPassword = Get-RecoveredSuperPassword -Port 5432
if ($null -eq $superPassword) { $superPassword = New-RandomString 24 }
$jwtSecret = New-RandomString 32
$jwtRefresh = New-RandomString 32
$apiKey = New-RandomString 32

# --- build the .env (template first, our generated keys override) -----------
$keysToOverride = @("SCHOOL_NAME","SCHOOL_SLUG","DATABASE_URL","DATABASE_NAME","DATABASE_USER","DATABASE_PASSWORD","POSTGRES_SUPERUSER_PASSWORD","JWT_SECRET","JWT_REFRESH_SECRET","API_KEY","SEED_ADMIN_NAME","SEED_ADMIN_EMAIL","SEED_ADMIN_PASSWORD")
$backendLines = @()
$template = Join-Path $BackendDir ".env.example"
if (Test-Path $template) {
  $backendLines = @(Get-Content $template | Where-Object {
    $_ -notmatch "^\s*($($keysToOverride -join "|"))\s*="
  })
}
$backendLines += ""
$backendLines += "# --- generated by the first-run wizard (tools\windows\scripts\setup.ps1) ---"
$backendLines += "SCHOOL_NAME=$($values.Name)"
$backendLines += "SCHOOL_SLUG=$slug"
$backendLines += "DATABASE_URL=postgresql://${dbUser}:${dbPassword}@localhost:5432/$dbName?schema=public"
$backendLines += "DATABASE_NAME=$dbName"
$backendLines += "DATABASE_USER=$dbUser"
$backendLines += "DATABASE_PASSWORD=$dbPassword"
$backendLines += "POSTGRES_SUPERUSER_PASSWORD=$superPassword"
$backendLines += "JWT_SECRET=$jwtSecret"
$backendLines += "JWT_REFRESH_SECRET=$jwtRefresh"
$backendLines += "API_KEY=$apiKey"
$backendLines += "SEED_ADMIN_NAME=$($values.Name) Administrator"
$backendLines += "SEED_ADMIN_EMAIL=$($values.Email)"
$backendLines += "SEED_ADMIN_PASSWORD=$($values.Password)"
$backendLines += ""
$backendLines += "# If the release repository is private, create a GitHub token with repo read access"
$backendLines += "# and paste it below. Public repos work without it."
$backendLines += "# GITHUB_TOKEN="

Set-Content -Path $BackendEnv -Value $backendLines -Encoding UTF8
Write-Host "  Configured apps\backend\.env" -ForegroundColor Green

# --- frontend .env.local (first run only; existing files are never touched) --
if (-not (Test-Path $FrontendEnv)) {
  $frontExample = Join-Path $FrontendDir ".env.example"
  if (Test-Path $frontExample) {
    Copy-Item $frontExample $FrontendEnv
    # The portal sends the install API key on every call: the template only
    # documents the empty slot, so stamp the generated key in.
    $frontLines = @(Get-Content $FrontendEnv | Where-Object { $_ -notmatch "^\s*NEXT_PUBLIC_API_KEY\s*=" })
    $frontLines += "NEXT_PUBLIC_API_KEY=$apiKey"
    Set-Content -Path $FrontendEnv -Value $frontLines -Encoding UTF8
    Write-Host "  Configured apps\frontend\.env.local" -ForegroundColor Green
  }
}

# --- tell the human what was created ------------------------------------------
Write-Host ""
Write-Host "  $($values.Name) is now set up." -ForegroundColor Green
Write-Host ""
Write-Host "  Database    : $dbName  (user: $dbUser)" -ForegroundColor DarkGray
Write-Host "  DB password : $dbPassword  (stored in apps\backend\.env)" -ForegroundColor DarkGray
Write-Host "  JWT secrets : random - stored in apps\backend\.env"
Write-Host "  API key     : random - stored in apps\backend\.env + apps\frontend\.env.local"
Write-Host "  Admin login : $($values.Email) / $($values.Password)" -ForegroundColor Cyan
Write-Host ""
exit 0