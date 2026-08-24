' Starts the servers at login, without opening the control panel.
'
' Used only by the optional "start automatically" task in the installer. A
' school that chose it wants the portal reachable when the machine comes up,
' not a window in their face — so this runs the launcher hidden and exits.
'
' The control panel remains the way to see status and stop things; this only
' removes the need to click Start every morning.

Option Explicit

Dim shell, fso, here, root, launcher, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)          ' installer\runtime
root = fso.GetParentFolderName(fso.GetParentFolderName(here))   ' application root
launcher = fso.BuildPath(root, "installer\engine\launcher.ps1")

If Not fso.FileExists(launcher) Then
  WScript.Quit 1
End If

command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File """ & launcher & """"

' 0 = hidden, False = do not wait. A failed start is visible in the control
' panel and in logs\; blocking login with a dialog would be worse.
shell.CurrentDirectory = root
shell.Run command, 0, False
