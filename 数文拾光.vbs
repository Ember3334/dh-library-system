' ============================================================
'  ShuWen DH Platform - silent launcher
'  Double-click (or use the .lnk shortcut) to start the platform
'  with NO console window. A browser tab opens when it is ready.
'
'  English-only on purpose: wscript.exe reads .vbs as ANSI,
'  so a UTF-8 Chinese string would render as mojibake.
' ============================================================
Option Explicit

Dim sh, fso, base, target, cmd, code

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base   = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(base, "scripts\launch.js")

If Not fso.FileExists(target) Then
  MsgBox "scripts\launch.js not found." & vbCrLf & _
         "Please keep this file in the project root folder.", 16, "ShuWen DH Platform"
  WScript.Quit 1
End If

' 0 = hidden window, True = wait for the exit code
cmd  = "cmd /c cd /d """ & base & """ && node """ & target & """"
code = sh.Run(cmd, 0, True)

If code = 0 Then
  ' Success: browser already opened, stay silent.
ElseIf code = 9009 Then
  MsgBox "Node.js not found." & vbCrLf & vbCrLf & _
         "Install Node.js 18 or newer from https://nodejs.org, then try again.", _
         16, "ShuWen DH Platform"
ElseIf code = 1 Then
  MsgBox "All ports 3000-3010 are taken by other programs." & vbCrLf & vbCrLf & _
         "Close whatever occupies them, or set PORT=3100 in .env and run again.", _
         16, "ShuWen DH Platform"
ElseIf code = 2 Then
  MsgBox "The service did not become ready." & vbCrLf & vbCrLf & _
         "A console window was opened with the error log." & vbCrLf & _
         "You can also read .runtime\platform.log", 48, "ShuWen DH Platform"
Else
  MsgBox "Launch failed (exit code " & code & ")." & vbCrLf & vbCrLf & _
         "See .runtime\platform.log, or double-click the .bat file" & vbCrLf & _
         "to view the full output.", 16, "ShuWen DH Platform"
End If
