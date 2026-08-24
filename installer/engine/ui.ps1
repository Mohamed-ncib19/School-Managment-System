<#
  Shared console presentation for the SCHOOL MANAGEMENT SYSTEM tools.

  Dot-sourced by launcher.ps1 and stop.ps1 so both windows look like one
  product rather than two unrelated scripts.

  IMPORTANT - why the glyphs are built from character codes instead of being
  typed literally: Windows PowerShell 5.1 reads a .ps1 saved as UTF-8 *without*
  a BOM as Windows-1252, which turns every multi-byte character into mojibake.
  That is exactly how an em dash in the previous launcher became "a???" and took
  the surrounding line down with a parser error. Composing them with [char]
  keeps this file pure ASCII, so it cannot be mis-decoded no matter how it is
  saved, while the console still prints proper box drawing.
#>

$script:UiWidth   = 64   # inner width, between the border characters
$script:UiUnicode = $false
$script:UiStep    = 0
$script:UiTotal   = 0
$script:UiStarted = $null
$script:UiProgressFile = $null

function Initialize-Ui {
  param([int]$TotalSteps = 0)

  $script:UiTotal   = $TotalSteps
  $script:UiStep    = 0
  $script:UiStarted = Get-Date

  # UTF-8 output lets the box drawing render. If the host refuses (redirected
  # or restricted), fall back to the ASCII glyph set instead of printing junk.
  try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $script:UiUnicode = $true
  } catch {
    $script:UiUnicode = $false
  }

  $script:G = if ($script:UiUnicode) {
    @{
      TL = [char]0x250C; TR = [char]0x2510; BL = [char]0x2514; BR = [char]0x2518
      H  = [char]0x2500; V  = [char]0x2502; ML = [char]0x251C; MR = [char]0x2524
      OK = [char]0x2713; NO = [char]0x2717; WARN = [char]0x0021
      FULL = [char]0x2588; EMPTY = [char]0x2591; ARROW = [char]0x203A
    }
  } else {
    @{
      TL = '+'; TR = '+'; BL = '+'; BR = '+'
      H  = '-'; V  = '|'; ML = '+'; MR = '+'
      # '*' rather than '+' for success: '+' is also the box corner, which made
      # status lines read as stray borders.
      OK = '*'; NO = 'x'; WARN = '!'
      FULL = '#'; EMPTY = '.'; ARROW = '>'
    }
  }
}

function Write-Rule {
  param([string]$Colour = "DarkGray")
  Write-Host ("  " + ($script:G.H.ToString() * ($script:UiWidth + 2))) -ForegroundColor $Colour
}

<#
  One or more bordered lines, padded so the right edge always lines up.

  Long text wraps on word boundaries rather than being cut off: these panels
  carry failure messages, and truncating one mid-sentence hides the part that
  tells the operator what to do.
#>
function Write-BoxLine {
  param([string]$Text = "", [string]$Colour = "Gray", [string]$BorderColour = "DarkCyan")

  $room = $script:UiWidth - 1
  $lines = @()

  if ([string]::IsNullOrEmpty($Text)) {
    $lines = @("")
  } else {
    $current = ""
    foreach ($word in $Text -split ' ') {
      if ($current -eq "") {
        $current = $word
      } elseif (($current.Length + 1 + $word.Length) -le $room) {
        $current = "$current $word"
      } else {
        $lines += $current
        $current = $word
      }
      # A single word longer than the box still has to be broken somewhere.
      while ($current.Length -gt $room) {
        $lines += $current.Substring(0, $room)
        $current = $current.Substring($room)
      }
    }
    if ($current -ne "") { $lines += $current }
  }

  foreach ($line in $lines) {
    Write-Host "  $($script:G.V) " -ForegroundColor $BorderColour -NoNewline
    Write-Host $line.PadRight($room) -ForegroundColor $Colour -NoNewline
    Write-Host $script:G.V -ForegroundColor $BorderColour
  }
}

function Write-BoxTop    { param([string]$Colour = "DarkCyan") Write-Host ("  " + $script:G.TL + ($script:G.H.ToString() * $script:UiWidth) + $script:G.TR) -ForegroundColor $Colour }
function Write-BoxMiddle { param([string]$Colour = "DarkCyan") Write-Host ("  " + $script:G.ML + ($script:G.H.ToString() * $script:UiWidth) + $script:G.MR) -ForegroundColor $Colour }
function Write-BoxBottom { param([string]$Colour = "DarkCyan") Write-Host ("  " + $script:G.BL + ($script:G.H.ToString() * $script:UiWidth) + $script:G.BR) -ForegroundColor $Colour }

function Write-Banner {
  param([string]$Title, [string]$Subtitle, [string]$Colour = "DarkCyan")
  Write-Host ""
  Write-BoxTop $Colour
  Write-Host "  $($script:G.V) " -ForegroundColor $Colour -NoNewline
  Write-Host $Title.PadRight($script:UiWidth - 1) -ForegroundColor White -NoNewline
  Write-Host $script:G.V -ForegroundColor $Colour
  if ($Subtitle) {
    Write-Host "  $($script:G.V) " -ForegroundColor $Colour -NoNewline
    Write-Host $Subtitle.PadRight($script:UiWidth - 1) -ForegroundColor DarkGray -NoNewline
    Write-Host $script:G.V -ForegroundColor $Colour
  }
  Write-BoxBottom $Colour
  Write-Host ""
}

<#
  Step header with an inline progress bar, e.g.

    [3/7] ########------------  Starting PostgreSQL

  The bar is printed fresh each time rather than redrawn in place: rewriting the
  line with a carriage return looks fine in a real console but leaves shredded
  output whenever the run is piped to a file or a log.
#>
function Write-Step {
  param([string]$Message)

  $script:UiStep++
  $barWidth = 20
  $filled = if ($script:UiTotal -gt 0) {
    [math]::Min($barWidth, [math]::Round($barWidth * $script:UiStep / $script:UiTotal))
  } else { 0 }

  Write-Host ""
  Write-Host "  [$($script:UiStep)/$($script:UiTotal)] " -ForegroundColor DarkGray -NoNewline
  Write-Host ($script:G.FULL.ToString() * $filled) -ForegroundColor Cyan -NoNewline
  Write-Host ($script:G.EMPTY.ToString() * ($barWidth - $filled)) -ForegroundColor DarkGray -NoNewline
  Write-Host "  $Message" -ForegroundColor White

  if ($script:UiProgressFile) { Write-UiProgress -State "running" -Label $Message }
}

function Write-Ok {
  param([string]$Message, [string]$Detail)
  Write-Host "         " -NoNewline
  Write-Host $script:G.OK -ForegroundColor Green -NoNewline
  Write-Host "  $Message" -ForegroundColor Gray -NoNewline
  if ($Detail) { Write-Host "  $Detail" -ForegroundColor DarkGray } else { Write-Host "" }
}

function Write-Info {
  param([string]$Message)
  Write-Host "            $Message" -ForegroundColor DarkGray
}

function Write-Warn2 {
  param([string]$Message)
  Write-Host "         " -NoNewline
  Write-Host $script:G.WARN -ForegroundColor Yellow -NoNewline
  Write-Host "  $Message" -ForegroundColor Yellow
}

function Write-Err {
  param([string]$Message)
  Write-Host "         " -NoNewline
  Write-Host $script:G.NO -ForegroundColor Red -NoNewline
  Write-Host "  $Message" -ForegroundColor Red
}

<#
  Waits for a condition, animating only when a human is watching.
  [Console]::IsOutputRedirected tells us whether the frames would end up in a
  log file instead of on screen.
#>
function Wait-For {
  param(
    [scriptblock]$Condition,
    [string]$Label,
    [int]$TimeoutSec = 150
  )

  $frames = if ($script:UiUnicode) {
    @([char]0x280B, [char]0x2819, [char]0x2839, [char]0x2838, [char]0x283C, [char]0x2834,
      [char]0x2826, [char]0x2827, [char]0x2807, [char]0x280F)
  } else { @('|', '/', '-', '\') }

  $animate = -not [Console]::IsOutputRedirected
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $i = 0

  while ((Get-Date) -lt $deadline) {
    if (& $Condition) {
      if ($animate) { Write-Host ("`r" + (" " * ($Label.Length + 20)) + "`r") -NoNewline }
      return $true
    }
    if ($animate) {
      Write-Host ("`r         {0}  {1}..." -f $frames[$i % $frames.Count], $Label) -ForegroundColor DarkGray -NoNewline
    }
    $i++
    Start-Sleep -Milliseconds 250
  }

  if ($animate) { Write-Host ("`r" + (" " * ($Label.Length + 20)) + "`r") -NoNewline }
  return $false
}

<#
  Closing panel. `Rows` accepts "Label|Value" pairs, "---" for a divider and a
  bare string for a full-width line.
#>
function Write-Panel {
  param(
    [string]$Title,
    [string[]]$Rows,
    [string]$Colour = "Green",
    [string]$Note,
    # ok | fail | none - a success tick on a failure panel reads as a mixed
    # signal, so the caller states which one it means.
    [ValidateSet("ok", "fail", "none")]
    [string]$Icon = "ok"
  )

  Write-Host ""
  Write-BoxTop $Colour
  Write-Host "  $($script:G.V) " -ForegroundColor $Colour -NoNewline
  $mark = switch ($Icon) {
    "ok"   { "$($script:G.OK)  " }
    "fail" { "$($script:G.NO)  " }
    default { "" }
  }
  $heading = "$mark$Title"
  if ($Note) {
    # -2 rather than -1 so the note keeps a space off the right border instead
    # of butting straight against it.
    $pad = $script:UiWidth - 2 - $heading.Length - $Note.Length
    if ($pad -lt 1) { $pad = 1 }
    Write-Host $heading -ForegroundColor $Colour -NoNewline
    Write-Host (" " * $pad) -NoNewline
    Write-Host "$Note " -ForegroundColor DarkGray -NoNewline
  } else {
    Write-Host $heading.PadRight($script:UiWidth - 1) -ForegroundColor $Colour -NoNewline
  }
  Write-Host $script:G.V -ForegroundColor $Colour

  foreach ($row in $Rows) {
    if ($row -eq "---") { Write-BoxMiddle $Colour; continue }
    if ($row -match "^([^|]+)\|(.*)$") {
      $label = $Matches[1].Trim()
      $value = $Matches[2].Trim()
      Write-Host "  $($script:G.V) " -ForegroundColor $Colour -NoNewline
      Write-Host $label.PadRight(12) -ForegroundColor DarkGray -NoNewline
      $room = $script:UiWidth - 13
      $shown = if ($value.Length -gt $room) { $value.Substring(0, $room) } else { $value }
      Write-Host $shown.PadRight($room) -ForegroundColor White -NoNewline
      Write-Host $script:G.V -ForegroundColor $Colour
    } else {
      Write-BoxLine -Text $row -Colour DarkGray -BorderColour $Colour
    }
  }

  Write-BoxBottom $Colour
  Write-Host ""
}

<# Human-readable time since Initialize-Ui, for the closing panel. #>
function Get-UiElapsed {
  if (-not $script:UiStarted) { return "" }
  $span = (Get-Date) - $script:UiStarted
  if ($span.TotalMinutes -ge 1) {
    return ("{0}m {1}s" -f [int]$span.TotalMinutes, $span.Seconds)
  }
  return ("{0:0.0}s" -f $span.TotalSeconds)
}

<#
  Optional progress journal read by the in-app update dialog
  (GET /api/updates/progress). The update engine sets the file once with
  Set-UiProgressFile; every Write-Step afterwards refreshes it, and
  Set-UiProgressResult closes it with the final state. Everything written is
  ASCII - the step labels come from these scripts, not from localised UI text.
#>
function Set-UiProgressFile {
  param([string]$Path)
  $script:UiProgressFile = $Path
}

function Write-UiProgress {
  param(
    [string]$State = "running",
    [string]$Label = "",
    [string]$Message = ""
  )

  if (-not $script:UiProgressFile) { return }

  $payload = [ordered]@{
    state     = $State
    step      = $script:UiStep
    stepTotal = $script:UiTotal
    label     = $Label
    message   = $Message
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  try {
    $dir = Split-Path -Parent $script:UiProgressFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $payload | ConvertTo-Json -Compress | Out-File -FilePath $script:UiProgressFile -Encoding utf8
  } catch { }
}

function Set-UiProgressResult {
  param([string]$State, [string]$Message)
  Write-UiProgress -State $State -Label $Message -Message $Message
}
