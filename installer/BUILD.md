# Building the Windows installer

The installer replaces the old `tools\windows\start.bat` / `stop.bat` pair. A
school runs one `setup.exe`, answers the wizard once, and from then on uses a
desktop shortcut that opens the control panel. They never see a script, a
console window, or a folder of tools.

---

## What ships

```
installer/
  iq-academy.iss        the Inno Setup script (this is what you compile)
  post-install.ps1      runs once after files land: Node, pnpm, school wizard, deps
  BUILD.md              this file
  runtime/              installed with the app, used every day
    launch.vbs          desktop shortcut target — opens the control panel, no console flash
    start-servers.vbs   optional "start at login" target — launcher only, no window
    control-panel.ps1   the window: status, start / stop / restart, open portal, help
    service-control.ps1 status and start/stop/restart logic, shared by the panel
    app.ico             shortcut and uninstall icon
  engine/               the working scripts (moved from tools\windows\scripts)
    launcher.ps1        prerequisites, PostgreSQL, schema, build, servers
    stop.ps1            stops the server tree and the portable database
    setup.ps1           first-run school details dialog
    ensure-postgres.ps1 finds or provisions PostgreSQL
    do-update.ps1       in-app update engine
    backup-before-schema.ps1  safety dump before a schema push
    machine-id.ps1, ui.ps1
  macos/                the macOS / Linux path, unchanged
    start.sh, scripts/
```

`installer/engine` is *runtime*, not install-time, despite living under
`installer/`. The in-app shutdown button and the in-app updater both invoke
these scripts directly (`apps/backend/src/system/system.service.ts` and
`apps/backend/src/updates/updates.service.ts`), so the paths are part of the
product's contract — moving them again means updating those two files, the
control panel, and `schema-push-safety.spec.ts`.

---

## Prerequisites

- **Inno Setup 6** — `winget install --id JRSoftware.InnoSetup`, or
  <https://jrsoftware.org/isdl.php>. The compiler is `ISCC.exe`. Note that
  winget installs it **per user**, at
  `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` — not under Program Files,
  which is where the documentation usually points.
- A **clean checkout**. The `[Files]` section excludes `node_modules`, build
  output, logs, backups, `.postgres`, `.cloud-creds`, `machine.lock` and the
  `.env` files — but it is far easier to reason about a tree that does not
  contain them in the first place.

## Compile

```powershell
& "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" installer\iq-academy.iss
```

A clean build ends with `Successful compile` and **no warnings**. Treat a
warning as a failure: the one this script hit during development
(`PrivilegesRequired=admin` with a per-user area) meant the "start at login"
shortcut would have been created in the *administrator's* Startup folder and
never fired for the school's own user.

Output lands in `dist-installer\SystemeGestionScolaire-Setup-<version>.exe`.

Bump `AppVersion` at the top of `iq-academy.iss` for each release. Leave
`AppId` alone — Windows uses it to recognise an upgrade rather than a second
parallel installation.

---

## What the installer does

1. Copies the application tree to `C:\Program Files\SchoolManagementSystem`
   (elevation required: the portable PostgreSQL runtime and the Node install
   both need it).
2. Runs `post-install.ps1`, which installs Node.js 20 LTS via winget if it is
   missing, enables pnpm through corepack, opens the school-details dialog,
   and runs `pnpm install`. Every step is idempotent, so it is safe to re-run
   by hand on a machine that half-installed.
3. Creates Start Menu and (optionally) desktop shortcuts, plus an optional
   login entry that starts the servers without opening a window.
4. Offers to open the control panel.

Uninstalling stops the servers and the portable database first, then removes
build output and `node_modules`. **It deliberately keeps `backups\`,
`.postgres\` and the `.env` files** — a school that uninstalls and reinstalls
must not lose its records. The uninstaller says so before it starts.

---

## Notes and known limits

- **The icon is a single 256px PNG-in-ICO**, generated from
  `apps/frontend/Public/images/logo.png`. Windows scales it, which is fine for
  a shortcut but soft at 16px in the taskbar. A proper multi-resolution icon
  (16/32/48/256) would be an improvement; nothing depends on it.
- **`launch.vbs` needs VBScript.** It is present and enabled on Windows 10 and
  11 today, but Microsoft has begun moving it to a Feature-on-Demand. If it is
  ever unavailable, point the shortcut straight at
  `powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "...\control-panel.ps1"`
  and accept a brief console flash. Nothing else depends on the shim.
- **PowerShell files must be saved UTF-8 *with BOM*.** Windows PowerShell 5.1
  reads a BOM-less file as ANSI, which turns every accented character into
  mojibake and produces parse errors that point at the wrong line. Every
  `.ps1` here has one; keep it that way when editing.
- **macOS and Linux are unchanged.** There is no Inno Setup equivalent, so
  `installer/macos/start.sh` remains the entry point there.

## Verifying a build without installing

```powershell
# Parse every script the installer ships — catches BOM and syntax problems.
Get-ChildItem installer -Recurse -Filter *.ps1 | ForEach-Object {
  $e = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$e)
  if ($e) { "FAIL $($_.Name)"; $e | Select-Object -First 3 } else { "OK   $($_.Name)" }
}

# Open the control panel against the working tree, without installing.
powershell -ExecutionPolicy Bypass -File installer\runtime\control-panel.ps1
```
