; ============================================================================
; Clavis — NSIS installer (SPEC §9.1)
; Per-user install (no admin), Start Menu shortcut, uninstaller, WebView2
; runtime bootstrap when missing. The uninstaller never touches
; %APPDATA%\Clavis (the user's data).
; ============================================================================

Unicode true
ManifestDPIAware true

!define APPNAME "Clavis"
!define VERSION "1.1.2"
!define COMPANY "Clavis"
!define DESCRIPTION "Clavis - your keys, one shortcut away."
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Clavis"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APPNAME} ${VERSION}"
OutFile "Clavis-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Clavis"
InstallDirRegKey HKCU "Software\Clavis" "InstallDir"
RequestExecutionLevel user

; ---------------------------------------------------------------------------
; Modern UI
; ---------------------------------------------------------------------------
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ABORTWARNING
!define MUI_ICON "..\..\appicon.ico"
!define MUI_UNICON "..\..\appicon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Clavis.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Clavis"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_LINK "Clavis runs in the background - look for the key icon near the clock."
!define MUI_FINISHPAGE_LINK_LOCATION ""

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Sections
; ---------------------------------------------------------------------------
Section "Clavis" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Stop a running Clavis so files can be replaced (best-effort).
  nsExec::ExecToLog 'taskkill /IM "Clavis.exe" /F'

  File "..\..\..\dist\Clavis.exe"

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\Clavis"
  CreateShortcut "$SMPROGRAMS\Clavis\Clavis.lnk" "$INSTDIR\Clavis.exe"
  CreateShortcut "$SMPROGRAMS\Clavis\Uninstall Clavis.lnk" "$INSTDIR\Uninstall.exe"

  ; Uninstaller + registry (per-user, HKCU)
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Clavis"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\Clavis.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"
  WriteRegStr HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegStr HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\Clavis" "InstallDir" "$INSTDIR"
SectionEnd

; WebView2 runtime (SPEC §9.1: bootstrap when missing).
Section "WebView2 runtime" SecWebView2
  ClearErrors
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  IfErrors 0 Found
  ClearErrors
  ReadRegStr $0 HKCU "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  IfErrors 0 Found
  ClearErrors
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  IfErrors 0 Found
  ClearErrors
  ReadRegStr $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\ClientState\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  IfErrors 0 Found

  DetailPrint "WebView2 runtime not found - installing it (per user)."
  SetOutPath "$INSTDIR"
  File "..\webview2-bootstrapper.exe"
  nsExec::ExecToLog '"$INSTDIR\webview2-bootstrapper.exe" /silent /install'
  Delete "$INSTDIR\webview2-bootstrapper.exe"
  Goto Done

Found:
  DetailPrint "WebView2 runtime found ($0)."

Done:
SectionEnd

; ---------------------------------------------------------------------------
; Uninstaller — removes the app only. %APPDATA%\Clavis (the data) is kept
; on purpose (SPEC §9.1).
; ---------------------------------------------------------------------------
Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM "Clavis.exe" /F'
  Sleep 500

  Delete "$INSTDIR\Clavis.exe"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\webview2-bootstrapper.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\Clavis\Clavis.lnk"
  Delete "$SMPROGRAMS\Clavis\Uninstall Clavis.lnk"
  RMDir "$SMPROGRAMS\Clavis"

  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\Clavis"
  ; NOTE: the HKCU Run entry and %APPDATA%\Clavis are intentionally left:
  ; Clavis re-creates the Run entry on its next start, and the data folder
  ; holds the user's items.
  IfFileExists "$APPDATA\Clavis\*.*" 0 DataNoteDone
    DetailPrint "Your data in $APPDATA\Clavis was kept. Delete that folder manually if you want to remove it too."
  DataNoteDone:
SectionEnd

Function .onInit
  ; Single-instance guard for the installer itself.
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "ClavisSetupMutex") p .r1 ?e'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONINFORMATION "The Clavis installer is already running."
    Abort
  ${EndIf}
FunctionEnd
