Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!include MUI2.nsh

!define PRODUCT_NAME "WebTools Native Phase 4E"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\WebToolsNativePhase4E"

Name "${PRODUCT_NAME}"
OutFile "WebTools-Native-Phase4E-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\WebTools Native Phase 4E"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
Icon "stage\app.ico"
UninstallIcon "stage\app.ico"

!define MUI_ABORTWARNING
!define MUI_ICON "stage\app.ico"
!define MUI_UNICON "stage\app.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install WebTools Native Host and Manager" SEC_INSTALL
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "stage\app.ico"
  File /r "stage\host\*.*"

  SetOutPath "$INSTDIR\Manager"
  File /r "stage\manager\*.*"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  IfSilent skip_shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\WebTools.lnk" "$INSTDIR\WebTools.NativeHost.exe" "" "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Start the WebTools Native Launcher"
  CreateShortcut "$DESKTOP\WebTools Native Phase 4E.lnk" "$INSTDIR\WebTools.NativeHost.exe" "" "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Start the WebTools Native Launcher"
skip_shortcuts:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\WebTools Native Phase 4E.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\WebTools.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
SectionEnd
