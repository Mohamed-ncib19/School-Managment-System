; ============================================================================
;  School Management System — Windows installer
;
;  Replaces the old tools\windows\start.bat / stop.bat pair. A school runs one
;  setup.exe, answers the wizard, and gets a desktop shortcut that opens the
;  control panel. They never see a script, a console or a folder of tools.
;
;  Build:  ISCC.exe installer\iq-academy.iss
;  See installer\BUILD.md for prerequisites and the release checklist.
; ============================================================================

#define AppName "Système de gestion scolaire"
#define AppShortName "SchoolManagementSystem"
#define AppPublisher "Mohamed Ncib"
#define AppVersion "1.0.0"
#define AppExeName "launch.vbs"

[Setup]
AppId={{7C4A1E52-9B3D-4F86-A1C2-6D5E8F0B3A74}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppShortName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\dist-installer
OutputBaseFilename=SystemeGestionScolaire-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; The app writes into its own directory (.env, logs, .postgres, backups), so
; it needs a location the service account can write to. Per-machine install
; under Program Files requires elevation; that is deliberate, because the
; PostgreSQL runtime and the Node install both need it.
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\installer\runtime\app.ico
; A school that reinstalls over a working install must not lose its data.
UsePreviousAppDir=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le bureau"; GroupDescription: "Raccourcis :"
Name: "startup"; Description: "Démarrer le système automatiquement à l'ouverture de session"; GroupDescription: "Démarrage :"; Flags: unchecked

[Files]
; The whole application tree, minus everything that is generated, private to
; a machine, or only meaningful in a developer checkout.
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "\.git\*,\node_modules\*,\apps\*\node_modules\*,\packages\*\node_modules\*,\dist-installer\*,\apps\backend\dist\*,\apps\frontend\.next\*,\apps\frontend\.next-build\*,\logs\*,\backups\*,\.postgres\*,\.cloud-creds\*,machine.lock,*.log,\apps\backend\.env,\apps\frontend\.env.local,\docs\plans\*"

[Icons]
; Both shortcuts point at the VBS shim so no console window flashes.
Name: "{group}\{#AppName}"; Filename: "{app}\installer\runtime\{#AppExeName}"; \
  IconFilename: "{app}\installer\runtime\app.ico"; Comment: "Ouvrir le panneau de contrôle"
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\installer\runtime\{#AppExeName}"; \
  IconFilename: "{app}\installer\runtime\app.ico"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{app}\installer\runtime\start-servers.vbs"; \
  IconFilename: "{app}\installer\runtime\app.ico"; Tasks: startup

[Run]
; Prerequisites, the school wizard and dependencies. Shown rather than hidden:
; installing Node and fetching packages takes minutes, and a silent progress
; bar during that reads as a hang.
Filename: "powershell.exe"; \
  Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\post-install.ps1"" -AppRoot ""{app}"""; \
  StatusMsg: "Configuration du système (cela peut prendre plusieurs minutes)..."; \
  Flags: waituntilterminated

; Offer to open the control panel straight away.
Filename: "{app}\installer\runtime\{#AppExeName}"; \
  Description: "Ouvrir le panneau de contrôle"; \
  Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Stop the servers and the portable database before removing any files;
; otherwise the uninstaller trips over locked node.exe and postgres.exe.
Filename: "powershell.exe"; \
  Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\engine\stop.ps1"" -StopDatabase"; \
  Flags: runhidden waituntilterminated; RunOnceId: "StopServers"

[UninstallDelete]
; Build output and logs are ours to remove. The school's data is NOT:
; backups\, .postgres\ and the .env files are deliberately left behind so an
; uninstall followed by a reinstall does not destroy a school's records.
Type: filesandordirs; Name: "{app}\apps\backend\dist"
Type: filesandordirs; Name: "{app}\apps\frontend\.next"
Type: filesandordirs; Name: "{app}\apps\frontend\.next-build"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\apps\backend\node_modules"
Type: filesandordirs; Name: "{app}\apps\frontend\node_modules"
Type: filesandordirs; Name: "{app}\packages\shared\node_modules"
Type: filesandordirs; Name: "{app}\logs"

[Code]
{ Warn before uninstalling that data is kept, so nobody assumes it was wiped. }
function InitializeUninstall(): Boolean;
begin
  Result := MsgBox(
    'Désinstaller le Système de gestion scolaire ?' + #13#10#13#10 +
    'Vos données sont conservées : la base de données, les sauvegardes et la ' +
    'configuration de l''école ne sont pas supprimées. Une réinstallation les ' +
    'retrouvera intactes.',
    mbConfirmation, MB_YESNO) = IDYES;
end;
