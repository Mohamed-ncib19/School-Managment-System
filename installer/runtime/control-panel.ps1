<#
  SCHOOL MANAGEMENT SYSTEM — desktop control panel.

  The single thing a school ever double-clicks. It replaces start.bat and
  stop.bat with one window that answers the only three questions an
  administrator has: is it running, how do I start or stop it, and who do I
  call when something is wrong.

  Built on WinForms deliberately. It ships with .NET Framework on every
  supported Windows, so the control panel adds no runtime, no bundled browser
  and nothing to install — which matters most in the one case it exists for:
  the servers are down and nothing else in the product is reachable.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

. "$PSScriptRoot\service-control.ps1"

# --- palette ---------------------------------------------------------------
# Mirrors the app's own surface/border/text tones so the panel reads as part
# of the product rather than a stray utility.
$Colors = @{
  Background = [System.Drawing.Color]::FromArgb(248, 249, 251)
  Surface    = [System.Drawing.Color]::White
  Border     = [System.Drawing.Color]::FromArgb(226, 232, 240)
  Text       = [System.Drawing.Color]::FromArgb(15, 23, 42)
  Muted      = [System.Drawing.Color]::FromArgb(100, 116, 139)
  Running    = [System.Drawing.Color]::FromArgb(22, 163, 74)
  Stopped    = [System.Drawing.Color]::FromArgb(148, 163, 184)
  Conflict   = [System.Drawing.Color]::FromArgb(217, 119, 6)
  Primary    = [System.Drawing.Color]::FromArgb(37, 99, 235)
  Danger     = [System.Drawing.Color]::FromArgb(220, 38, 38)
}

function New-Font {
  param([single]$Size = 9, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
  return New-Object System.Drawing.Font("Segoe UI", $Size, $Style)
}

# --- window ----------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "Système de gestion scolaire"
$form.Size = New-Object System.Drawing.Size(460, 500)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false
$form.BackColor = $Colors.Background
$form.Font = New-Font 9

$iconPath = Join-Path $PSScriptRoot "app.ico"
if (Test-Path $iconPath) {
  try { $form.Icon = New-Object System.Drawing.Icon($iconPath) } catch { }
}

# --- header ----------------------------------------------------------------
$header = New-Object System.Windows.Forms.Panel
$header.Size = New-Object System.Drawing.Size(460, 64)
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.BackColor = $Colors.Surface
$form.Controls.Add($header)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Système de gestion scolaire"
$title.Font = New-Font 12 ([System.Drawing.FontStyle]::Bold)
$title.ForeColor = $Colors.Text
$title.Location = New-Object System.Drawing.Point(20, 12)
$title.Size = New-Object System.Drawing.Size(320, 24)
$header.Controls.Add($title)

$overallLabel = New-Object System.Windows.Forms.Label
$overallLabel.Font = New-Font 9
$overallLabel.ForeColor = $Colors.Muted
$overallLabel.Location = New-Object System.Drawing.Point(20, 36)
$overallLabel.Size = New-Object System.Drawing.Size(400, 20)
$header.Controls.Add($overallLabel)

# --- status rows -----------------------------------------------------------
$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(16, 80)
$statusPanel.Size = New-Object System.Drawing.Size(412, 132)
$statusPanel.BackColor = $Colors.Surface
$statusPanel.BorderStyle = "FixedSingle"
$form.Controls.Add($statusPanel)

$rowLabels = @{}
$rowNames = @("Portail web", "API", "Base de données")
for ($i = 0; $i -lt $rowNames.Count; $i++) {
  $y = 14 + ($i * 38)

  $dot = New-Object System.Windows.Forms.Label
  $dot.Text = [char]0x25CF   # filled circle
  $dot.Font = New-Font 14
  $dot.ForeColor = $Colors.Stopped
  $dot.Location = New-Object System.Drawing.Point(14, ($y - 3))
  $dot.Size = New-Object System.Drawing.Size(20, 22)
  $statusPanel.Controls.Add($dot)

  $name = New-Object System.Windows.Forms.Label
  $name.Text = $rowNames[$i]
  $name.Font = New-Font 9.5 ([System.Drawing.FontStyle]::Bold)
  $name.ForeColor = $Colors.Text
  $name.Location = New-Object System.Drawing.Point(38, $y)
  $name.Size = New-Object System.Drawing.Size(150, 18)
  $statusPanel.Controls.Add($name)

  $detail = New-Object System.Windows.Forms.Label
  $detail.Font = New-Font 8
  $detail.ForeColor = $Colors.Muted
  $detail.Location = New-Object System.Drawing.Point(38, ($y + 16))
  $detail.Size = New-Object System.Drawing.Size(360, 16)
  $statusPanel.Controls.Add($detail)

  $rowLabels[$rowNames[$i]] = @{ Dot = $dot; Detail = $detail }
}

# --- buttons ---------------------------------------------------------------
function New-ActionButton {
  param(
    [string]$Text,
    [int]$X, [int]$Y, [int]$Width,
    [System.Drawing.Color]$Accent,
    [bool]$Filled = $false
  )
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $Text
  $b.Location = New-Object System.Drawing.Point($X, $Y)
  $b.Size = New-Object System.Drawing.Size($Width, 38)
  $b.FlatStyle = "Flat"
  $b.Font = New-Font 9.5 ([System.Drawing.FontStyle]::Bold)
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  if ($Filled) {
    $b.BackColor = $Accent
    $b.ForeColor = [System.Drawing.Color]::White
    $b.FlatAppearance.BorderSize = 0
  } else {
    $b.BackColor = $Colors.Surface
    $b.ForeColor = $Accent
    $b.FlatAppearance.BorderColor = $Colors.Border
  }
  $form.Controls.Add($b)
  return $b
}

$startBtn   = New-ActionButton -Text "Démarrer"  -X 16  -Y 228 -Width 130 -Accent $Colors.Primary -Filled $true
$stopBtn    = New-ActionButton -Text "Arrêter"   -X 156 -Y 228 -Width 130 -Accent $Colors.Danger
$restartBtn = New-ActionButton -Text "Redémarrer" -X 296 -Y 228 -Width 132 -Accent $Colors.Muted

$openBtn = New-ActionButton -Text "Ouvrir le portail" -X 16 -Y 276 -Width 412 -Accent $Colors.Primary
$openBtn.Font = New-Font 10 ([System.Drawing.FontStyle]::Bold)

$helpBtn = New-ActionButton -Text "Aide et assistance" -X 16 -Y 324 -Width 412 -Accent $Colors.Text

# --- activity line ---------------------------------------------------------
$activity = New-Object System.Windows.Forms.Label
$activity.Font = New-Font 8.5
$activity.ForeColor = $Colors.Muted
$activity.Location = New-Object System.Drawing.Point(16, 374)
$activity.Size = New-Object System.Drawing.Size(412, 36)
$activity.Text = ""
$form.Controls.Add($activity)

$footer = New-Object System.Windows.Forms.Label
$footer.Font = New-Font 8
$footer.ForeColor = $Colors.Muted
$footer.Text = "Cette fenêtre peut être fermée : le système continue de fonctionner."
$footer.Location = New-Object System.Drawing.Point(16, 418)
$footer.Size = New-Object System.Drawing.Size(412, 18)
$form.Controls.Add($footer)

# --- rendering -------------------------------------------------------------
function Set-Activity {
  param([string]$Message)
  $activity.Text = $Message
  $activity.Refresh()
}

function Update-Status {
  <# Repaints the three rows and enables only the actions that make sense. #>
  try {
    $status = Get-ServiceStatus
  } catch {
    $overallLabel.Text = "État indisponible : $($_.Exception.Message)"
    return
  }

  foreach ($row in $status.Rows) {
    $ui = $rowLabels[$row.Name]
    if (-not $ui) { continue }
    $ui.Detail.Text = $row.Detail
    $ui.Dot.ForeColor = switch ($row.State) {
      "running"  { $Colors.Running }
      "conflict" { $Colors.Conflict }
      "external" { $Colors.Running }
      default    { $Colors.Stopped }
    }
  }

  switch ($status.Overall) {
    "running"  { $overallLabel.Text = "En marche"; $overallLabel.ForeColor = $Colors.Running }
    "partial"  { $overallLabel.Text = "Démarrage en cours…"; $overallLabel.ForeColor = $Colors.Conflict }
    "conflict" { $overallLabel.Text = "Un autre programme occupe un port"; $overallLabel.ForeColor = $Colors.Conflict }
    default    { $overallLabel.Text = "Arrêté"; $overallLabel.ForeColor = $Colors.Muted }
  }

  $isRunning = $status.Overall -eq "running"
  $isStopped = $status.Overall -eq "stopped"
  $startBtn.Enabled   = -not $isRunning
  $stopBtn.Enabled    = -not $isStopped
  $restartBtn.Enabled = -not $isStopped
  $openBtn.Enabled    = $isRunning
}

function Set-Busy {
  param([bool]$Busy)
  foreach ($b in @($startBtn, $stopBtn, $restartBtn, $openBtn, $helpBtn)) { $b.Enabled = -not $Busy }
  $form.Cursor = if ($Busy) { [System.Windows.Forms.Cursors]::WaitCursor } else { [System.Windows.Forms.Cursors]::Default }
}

# --- actions ---------------------------------------------------------------
$startBtn.Add_Click({
  Set-Busy $true
  Set-Activity "Démarrage… la première fois, cela peut prendre plusieurs minutes."
  try {
    Start-AppServices
    Set-Activity "Démarrage lancé. Cette fenêtre se met à jour toute seule."
  } catch {
    Set-Activity "Échec du démarrage : $($_.Exception.Message)"
  }
  Set-Busy $false
  Update-Status
})

$stopBtn.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Arrêter le système ? Les utilisateurs connectés seront déconnectés.",
    "Confirmer l'arrêt",
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }

  Set-Busy $true
  Set-Activity "Arrêt en cours…"
  try {
    $clean = Stop-AppServices
    Set-Activity $(if ($clean) { "Système arrêté." } else { "Arrêt demandé — un processus met du temps à se fermer." })
  } catch {
    Set-Activity "Échec de l'arrêt : $($_.Exception.Message)"
  }
  Set-Busy $false
  Update-Status
})

$restartBtn.Add_Click({
  Set-Busy $true
  Set-Activity "Redémarrage…"
  try {
    Restart-AppServices
    Set-Activity "Redémarrage lancé."
  } catch {
    Set-Activity "Échec du redémarrage : $($_.Exception.Message)"
  }
  Set-Busy $false
  Update-Status
})

$openBtn.Add_Click({ Open-AppPortal })

$helpBtn.Add_Click({
  # Deliberately the same contacts and the same shape of report as the in-app
  # "Signal un problème" dialog — a school should not learn two support paths.
  Set-Busy $true
  Set-Activity "Lecture des coordonnées d'assistance…"
  try { $c = Get-SupportContacts } catch { $c = $null }
  Set-Busy $false
  Set-Activity ""
  if (-not $c) { return }

  $status = try { (Get-ServiceStatus).Overall } catch { "inconnu" }
  $subject = "[Rapport technique] Technique - $($c.School)"
  $body = @(
    "Ecole : $($c.School)",
    "Date : $(Get-Date -Format 'dd/MM/yyyy HH:mm')",
    "Type de probleme : Technique",
    "Etat des serveurs : $status",
    "",
    "Decrivez le probleme ici :",
    ""
  ) -join "`r`n"

  Show-HelpDialog -Contacts $c -Subject $subject -Body $body
})

function Show-HelpDialog {
  param($Contacts, [string]$Subject, [string]$Body)

  $dlg = New-Object System.Windows.Forms.Form
  $dlg.Text = "Aide et assistance"
  $dlg.Size = New-Object System.Drawing.Size(400, 300)
  $dlg.StartPosition = "CenterParent"
  $dlg.FormBorderStyle = "FixedDialog"
  $dlg.MaximizeBox = $false
  $dlg.MinimizeBox = $false
  $dlg.BackColor = $Colors.Background
  $dlg.Font = New-Font 9

  $intro = New-Object System.Windows.Forms.Label
  $intro.Text = "Décrivez votre problème par e-mail ou WhatsApp. L'état du système est joint automatiquement."
  $intro.Location = New-Object System.Drawing.Point(20, 18)
  $intro.Size = New-Object System.Drawing.Size(345, 40)
  $intro.ForeColor = $Colors.Muted
  $dlg.Controls.Add($intro)

  $mail = New-Object System.Windows.Forms.Button
  $mail.Text = "Envoyer un e-mail"
  $mail.Location = New-Object System.Drawing.Point(20, 68)
  $mail.Size = New-Object System.Drawing.Size(345, 38)
  $mail.FlatStyle = "Flat"
  $mail.BackColor = $Colors.Primary
  $mail.ForeColor = [System.Drawing.Color]::White
  $mail.FlatAppearance.BorderSize = 0
  $mail.Font = New-Font 9.5 ([System.Drawing.FontStyle]::Bold)
  $mail.Add_Click({
    $u = "mailto:$($Contacts.Email)?subject=$([System.Uri]::EscapeDataString($Subject))&body=$([System.Uri]::EscapeDataString($Body))"
    Start-Process $u
  }.GetNewClosure())
  $dlg.Controls.Add($mail)

  $wa = New-Object System.Windows.Forms.Button
  $wa.Text = "Envoyer sur WhatsApp"
  $wa.Location = New-Object System.Drawing.Point(20, 114)
  $wa.Size = New-Object System.Drawing.Size(345, 38)
  $wa.FlatStyle = "Flat"
  $wa.BackColor = $Colors.Surface
  $wa.ForeColor = $Colors.Running
  $wa.FlatAppearance.BorderColor = $Colors.Border
  $wa.Font = New-Font 9.5 ([System.Drawing.FontStyle]::Bold)
  $wa.Add_Click({
    $u = "https://wa.me/$($Contacts.WhatsApp)?text=$([System.Uri]::EscapeDataString("$Subject`n$Body"))"
    Start-Process $u
  }.GetNewClosure())
  $dlg.Controls.Add($wa)

  $phone = New-Object System.Windows.Forms.Label
  $phone.Text = "Téléphone : $($Contacts.Phone)"
  $phone.Location = New-Object System.Drawing.Point(20, 164)
  $phone.Size = New-Object System.Drawing.Size(345, 20)
  $phone.ForeColor = $Colors.Text
  $dlg.Controls.Add($phone)

  $logs = New-Object System.Windows.Forms.Button
  $logs.Text = "Ouvrir le dossier des journaux"
  $logs.Location = New-Object System.Drawing.Point(20, 192)
  $logs.Size = New-Object System.Drawing.Size(345, 32)
  $logs.FlatStyle = "Flat"
  $logs.BackColor = $Colors.Surface
  $logs.ForeColor = $Colors.Text
  $logs.FlatAppearance.BorderColor = $Colors.Border
  $logs.Add_Click({
    $dir = Join-Path (Get-AppRoot) "logs"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Start-Process explorer.exe $dir
  })
  $dlg.Controls.Add($logs)

  $close = New-Object System.Windows.Forms.Button
  $close.Text = "Fermer"
  $close.Location = New-Object System.Drawing.Point(145, 232)
  $close.Size = New-Object System.Drawing.Size(95, 30)
  $close.FlatStyle = "Flat"
  $close.BackColor = $Colors.Surface
  $close.FlatAppearance.BorderColor = $Colors.Border
  $close.Add_Click({ $dlg.Close() })
  $dlg.Controls.Add($close)

  $dlg.ShowDialog($form) | Out-Null
  $dlg.Dispose()
}

# --- live refresh ----------------------------------------------------------
# A start takes a while to finish; polling is what lets the window reflect it
# without the administrator clicking anything.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-Status })
$timer.Start()

$form.Add_Shown({ Update-Status })
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })

[void]$form.ShowDialog()
