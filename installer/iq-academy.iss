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
#define AppVersion "1.0.2"
#define AppExeName "launch.vbs"

[Setup]
AppId={{7C4A1E52-9B3D-4F86-A1C2-6D5E8F0B3A74}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; NOT {autopf}. The application writes inside its own directory the entire
; time it runs -- apps\backend\.env, logs\, backups\, .postgres\data\, the
; Next.js build output and node_modules -- and the control panel that drives
; all of that is opened from a desktop shortcut, so it runs UNELEVATED.
; Program Files denies writes to an unelevated process, which would leave the
; shortcut opening a panel whose Start button fails every single time.
;
; Elevating the panel instead is not an option: PostgreSQL refuses to run
; under an account holding administrative rights, so the database has to start
; unprivileged and therefore needs a data directory it can actually write.
;
; A short root also keeps pnpm's nested node_modules paths well clear of the
; 260-character path limit, which "C:\Program Files\SchoolManagementSystem"
; does not.
DefaultDirName={sd}\{#AppShortName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=..\dist-installer
OutputBaseFilename=SystemeGestionScolaire-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Setup itself needs elevation: it installs Node.js, it may install the
; PostgreSQL runtime, and it grants the install folder to the Users group.
; Only setup is elevated -- nothing the school runs day to day is.
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
  Excludes: "\.git\*,\node_modules\*,\apps\*\node_modules\*,\packages\*\node_modules\*,\dist-installer\*,\apps\backend\dist\*,\apps\frontend\.next\*,\apps\frontend\.next-build\*,\logs\*,\backups\*,\.postgres\*,\.cloud-creds\*,machine.lock,*.log,\apps\backend\.env,\apps\frontend\.env.local,\skills\*,\docs\*"

[Icons]
; Both shortcuts point at the VBS shim so no console window flashes.
Name: "{group}\{#AppName}"; Filename: "{app}\installer\runtime\{#AppExeName}"; \
  IconFilename: "{app}\installer\runtime\app.ico"; Comment: "Ouvrir le panneau de contrôle"
Name: "{group}\Désinstaller {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\installer\runtime\{#AppExeName}"; \
  IconFilename: "{app}\installer\runtime\app.ico"; Tasks: desktopicon
; {commonstartup}, not {userstartup}: this installer runs elevated, so a
; per-user area resolves to the ADMINISTRATOR's Startup folder — the school
; user would never see it fire. The machine is dedicated to the school, so
; starting for whoever logs in is also the behaviour actually wanted.
Name: "{commonstartup}\{#AppName}"; Filename: "{app}\installer\runtime\start-servers.vbs"; \
  IconFilename: "{app}\installer\runtime\app.ico"; Tasks: startup

[Run]
; The setup work -- prerequisites, the school's configuration, dependencies --
; is driven from CurStepChanged below rather than from an entry here, because
; a [Run] entry discards the exit code: a failed Node.js install or a
; cancelled wizard would still finish "successfully" and hand the school a
; desktop shortcut to a system that cannot start.

; Open the control panel as soon as setup finishes. Checked by default: the
; desktop shortcut opens this same window, so seeing it once is also how the
; administrator learns where the system is controlled from.
Filename: "{app}\installer\runtime\{#AppExeName}"; \
  Description: "Ouvrir le panneau de contrôle"; \
  Flags: postinstall nowait skipifsilent shellexec

[UninstallRun]
; Stop the servers and the portable database before removing any files;
; otherwise the uninstaller trips over locked node.exe and postgres.exe.
Filename: "powershell.exe"; \
  Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\engine\stop.ps1"" -StopDatabase"; \
  Flags: runhidden waituntilterminated; RunOnceId: "StopServers"

[InstallDelete]
; Leftovers from releases that shipped them (<= 1.1.1): an upgrade overwrites
; and adds files but never removes ones that left the package, so without this
; the unpublished skills/ and docs/ folders would sit in {app} forever.
Type: filesandordirs; Name: "{app}\skills"
Type: filesandordirs; Name: "{app}\docs"

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
var
  IsUpgrade: Boolean;
  PreviousDir: String;
  PreviousVersion: String;

{
  Where Inno records a previous install of this AppId.

  The GUID is spelled out rather than derived from the [Setup] AppId via
  SetupSetting: that indirection expands differently depending on how AppId
  escapes its braces, and getting it subtly wrong means the installer simply
  never detects an existing installation — a silent failure. If you change
  AppId above, change this line with it.
}
function UninstallKey(): String;
begin
  Result := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' +
            '{7C4A1E52-9B3D-4F86-A1C2-6D5E8F0B3A74}_is1';
end;

{ Reads the previous installation's folder and version, if there is one. }
function FindPreviousInstall(): Boolean;
var
  Dir, Ver: String;
begin
  Result := False;
  PreviousDir := '';
  PreviousVersion := '';
  if RegQueryStringValue(HKLM, UninstallKey(), 'InstallLocation', Dir) and (Dir <> '') then
  begin
    PreviousDir := RemoveBackslash(Dir);
    RegQueryStringValue(HKLM, UninstallKey(), 'DisplayVersion', Ver);
    PreviousVersion := Ver;
    Result := True;
  end;
end;

{
  Decide up front whether this is a first install or a repeat, and say so.

  Silently upgrading is the wrong default here: a school that double-clicks
  setup.exe a second time — because a shortcut vanished, or because they are
  not sure it worked — needs to be told the system is already installed and
  where, not walked through a wizard that looks identical to a fresh install.
}
function InitializeSetup(): Boolean;
var
  Answer: Integer;
  Where: String;
begin
  Result := True;
  IsUpgrade := FindPreviousInstall();

  if not IsUpgrade then
    Exit;

  Where := PreviousDir;
  if Where = '' then
    Where := '(emplacement inconnu)';

  Answer := MsgBox(
    'Le Système de gestion scolaire est déjà installé sur cet ordinateur.' + #13#10#13#10 +
    'Emplacement : ' + Where + #13#10 +
    'Version installée : ' + PreviousVersion + #13#10 +
    'Version de ce programme : {#AppVersion}' + #13#10#13#10 +
    'Voulez-vous le réinstaller au même endroit ?' + #13#10#13#10 +
    'Vos données sont conservées : la base de données, les sauvegardes et la ' +
    'configuration de l''école ne sont pas touchées. Seuls les fichiers du ' +
    'programme sont remplacés.' + #13#10#13#10 +
    'Choisissez « Non » pour quitter sans rien changer.',
    mbConfirmation, MB_YESNO);

  if Answer <> IDYES then
  begin
    Result := False;
    Exit;
  end;
end;

{ A repeat install has nothing to ask: it goes back where it already lives. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsUpgrade and (PageID = wpSelectDir);
end;

{ Reflect which of the two things is happening on the confirmation page. }
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  if IsUpgrade then
    Result := 'Réinstallation par-dessus la version ' + PreviousVersion + NewLine + NewLine
  else
    Result := 'Première installation — la configuration de l''école sera demandée.' + NewLine + NewLine;

  Result := Result + MemoDirInfo + NewLine + NewLine + MemoTasksInfo;
end;

{
  Prerequisites, the school's own configuration and its dependencies.

  Driven from here rather than from a [Run] entry so that the exit code is
  actually read. post-install.ps1 answers 0 = ready, 1 = the administrator
  cancelled, 2 = failed; a [Run] entry throws all three away, and reporting
  "installed" over a system that cannot start is the worst thing this
  installer could do to a school.

  The window is shown rather than hidden on purpose: installing Node.js and
  fetching packages takes minutes, and a silent progress bar for that long is
  indistinguishable from a hang.
}
procedure RunPostInstall();
var
  ResultCode: Integer;
  Params: String;
begin
  WizardForm.StatusLabel.Caption :=
    'Configuration du système (cela peut prendre plusieurs minutes)...';

  Params := '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' +
            ExpandConstant('{app}\installer\post-install.ps1') +
            '" -AppRoot "' + ExpandConstant('{app}') + '"';

  if not Exec('powershell.exe', Params, ExpandConstant('{app}'), SW_SHOW,
              ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('La configuration n''a pas pu être lancée.' + #13#10#13#10 +
           SysErrorMessage(ResultCode) + #13#10#13#10 +
           'Les fichiers sont en place. Relancez la configuration par un clic ' +
           'droit sur ce fichier, puis « Exécuter avec PowerShell » :' + #13#10 +
           ExpandConstant('{app}\installer\post-install.ps1'),
           mbCriticalError, MB_OK);
    Exit;
  end;

  if ResultCode = 1 then
    MsgBox('Configuration interrompue.' + #13#10#13#10 +
           'Les fichiers sont installés, mais l''école n''est pas encore ' +
           'configurée. Ouvrez le panneau de contrôle depuis le raccourci du ' +
           'bureau et cliquez sur « Démarrer » pour la terminer.',
           mbInformation, MB_OK)
  else if ResultCode <> 0 then
    { A continuation line must never begin with '#': the preprocessor reads
      it as a directive and aborts the build. Keep #13#10 mid-line. }
    MsgBox('La configuration a échoué (code ' + IntToStr(ResultCode) + ').' + #13#10#13#10 +
           'Le journal détaillé se trouve dans :' + #13#10 +
           ExpandConstant('{app}\logs') + #13#10#13#10 +
           'Le système ne pourra pas démarrer tant que ce problème persiste. ' +
           'Envoyez ce journal à l''assistance.',
           mbCriticalError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    RunPostInstall();
end;

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
