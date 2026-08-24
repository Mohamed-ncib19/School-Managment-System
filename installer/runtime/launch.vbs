' Launches the control panel with no console window.
'
' The desktop shortcut points here rather than straight at powershell.exe:
' a shortcut to PowerShell flashes a black console for a second before the
' window appears, which reads as "something crashed" to a school
' administrator. WScript.Shell with an intWindowStyle of 0 suppresses it.
'
' If VBScript is ever disabled on a target machine, the fallback is to point
' the shortcut at powershell.exe directly with -WindowStyle Hidden and accept
' the flash — nothing else in the product depends on this file.

Option Explicit

Dim shell, fso, here, panel, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
panel = fso.BuildPath(here, "control-panel.ps1")

If Not fso.FileExists(panel) Then
  MsgBox "Fichier introuvable :" & vbCrLf & panel & vbCrLf & vbCrLf & _
         "Réinstallez le Système de gestion scolaire.", 16, "Système de gestion scolaire"
  WScript.Quit 1
End If

command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File """ & panel & """"

' 0 = hidden window, False = do not wait for it to exit.
shell.Run command, 0, False
