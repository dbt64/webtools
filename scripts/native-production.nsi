Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!include MUI2.nsh
!include FileFunc.nsh
!include LogicLib.nsh
!include StrFunc.nsh
!include nsDialogs.nsh
${StrStr}

!define PRODUCT_NAME "WebTools"
!define UNINSTALL_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"
!define UNINSTALL_KEY "${UNINSTALL_ROOT}\WebToolsNative"
!define TEST_UNINSTALL_KEY "${UNINSTALL_ROOT}\WebToolsNativePhase4FTest"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${PRODUCT_NAME}"
OutFile "WebTools-Setup-0.1.0.exe"
InstallDir "$LOCALAPPDATA\Programs\WebTools"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
Icon "stage\app.ico"
UninstallIcon "stage\app.ico"

!define MUI_ABORTWARNING
!define MUI_ICON "stage\app.ico"
!define MUI_UNICON "stage\app.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\WebTools.NativeHost.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 WebTools"
!define MUI_PAGE_CUSTOMFUNCTION_PRE DirectoryPagePre
!insertmacro MUI_PAGE_DIRECTORY
Page custom UpdatePageCreate UpdatePageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var IsTestInstall
Var WasAutoStartEnabled
Var UpdateStatus

Function .onInit
  SetShellVarContext current
  StrCpy $IsTestInstall "0"
  StrCpy $WasAutoStartEnabled "0"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PHASE4FTEST" $1
  IfErrors +2
    StrCpy $IsTestInstall "1"
FunctionEnd

Function FindPreviousWebTools
  StrCpy $R0 0
  find_previous:
    EnumRegKey $R1 HKCU "${UNINSTALL_ROOT}" $R0
    StrCmp $R1 "" not_found
    ReadRegStr $R2 HKCU "${UNINSTALL_ROOT}\$R1" "DisplayName"
    StrCmp $R1 "WebToolsNative" check_native_product
    StrCpy $R6 $R2 9
    StrCmp $R6 "${PRODUCT_NAME} " check_versioned_product next_key
  check_native_product:
    StrCmp $R2 "${PRODUCT_NAME}" matching_product next_key
  check_versioned_product:
    StrCpy $R6 $R2 "" 9
    StrCpy $R7 $R6 1
    StrCmp $R7 "0" check_version_dot
    StrCmp $R7 "1" check_version_dot
    StrCmp $R7 "2" check_version_dot
    StrCmp $R7 "3" check_version_dot
    StrCmp $R7 "4" check_version_dot
    StrCmp $R7 "5" check_version_dot
    StrCmp $R7 "6" check_version_dot
    StrCmp $R7 "7" check_version_dot
    StrCmp $R7 "8" check_version_dot
    StrCmp $R7 "9" check_version_dot next_key
  check_version_dot:
    ${StrStr} $R7 $R6 "."
    StrCmp $R7 "" next_key
    ${StrStr} $R7 $R6 " "
    StrCmp $R7 "" check_version_uninstaller next_key
  check_version_uninstaller:
    ReadRegStr $R3 HKCU "${UNINSTALL_ROOT}\$R1" "UninstallString"
    ${StrStr} $R7 $R3 "Uninstall WebTools.exe"
    StrCmp $R7 "" next_key
    Goto matching_product
  matching_product:
    ReadRegStr $R3 HKCU "${UNINSTALL_ROOT}\$R1" "UninstallString"
    StrCmp $R3 "" next_key
    ReadRegStr $R8 HKCU "${UNINSTALL_ROOT}\$R1" "InstallLocation"
    Return
  next_key:
    IntOp $R0 $R0 + 1
    Goto find_previous
  not_found:
    StrCpy $R3 ""
    StrCpy $R8 ""
FunctionEnd

Function ExtractUpdateHelper
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "stage\updater\WebTools.UpdateHelper.exe"
FunctionEnd

Function DirectoryPagePre
  StrCmp $IsTestInstall "1" done
  Call FindPreviousWebTools
  StrCmp $R3 "" done
  StrCmp $R8 "" done
  ; Updates reuse the recognized installation directory without asking again.
  StrCpy $INSTDIR $R8
  Abort
  done:
FunctionEnd

Function UpdatePageCreate
  StrCmp $IsTestInstall "1" skip_page
  Call FindPreviousWebTools
  StrCmp $R3 "" skip_page
  StrCmp $R8 "" skip_page
  Call ExtractUpdateHelper
  ClearErrors
  ExecWait '"$PLUGINSDIR\WebTools.UpdateHelper.exe" --check-install "$R8\."' $R9
  IfErrors show_page
  IntCmp $R9 0 skip_page show_page show_page
  show_page:
    !insertmacro MUI_HEADER_TEXT "更新 WebTools" "退出正在运行的 WebTools，然后继续当前更新。"
    nsDialogs::Create 1018
    Pop $0
    StrCmp $0 error skip_page
    ${NSD_CreateLabel} 0 0 100% 50u "WebTools 仍在后台运行。点击“退出后台”会正常关闭 WebTools 及其主界面，然后自动继续安装。"
    Pop $UpdateStatus
    ${NSD_CreateLabel} 0 60u 100% 45u "本次更新将使用现有安装目录：$\r$\n$R8$\r$\n$\r$\n点击“取消”可以停止更新。"
    Pop $0
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:退出后台"
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}
    nsDialogs::Show
    Return
  skip_page:
    Abort
FunctionEnd

Function UpdatePageLeave
  ${NSD_SetText} $UpdateStatus "正在等待 WebTools 正常退出，请稍候……"
  ClearErrors
  ExecWait '"$PLUGINSDIR\WebTools.UpdateHelper.exe" --prepare-install "$R8\."' $R9
  IfErrors preparation_failed
  IntCmp $R9 0 prepared preparation_failed preparation_failed
  preparation_failed:
    ${NSD_SetText} $UpdateStatus "WebTools 尚未正常退出（检测代码 $R9）。你可以先从托盘退出，再点击下方按钮继续。安装窗口会保留，尚未卸载旧版或替换文件。"
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:重试退出"
    Abort
  prepared:
FunctionEnd

Function RemovePreviousWebTools
  StrCmp $IsTestInstall "1" done
  Call ExtractUpdateHelper
  ReadRegStr $R5 HKCU "${RUN_KEY}" "WebTools"
  StrCmp $R5 "" no_previous_startup
  StrCpy $WasAutoStartEnabled "1"
  no_previous_startup:
  find_previous:
    Call FindPreviousWebTools
    StrCmp $R3 "" done
    StrCmp $R8 "" update_location_failed
    DetailPrint "Removing the previous WebTools installation."
  check_previous_processes:
    DetailPrint "Checking that the previous WebTools processes have exited."
    ClearErrors
    ExecWait '"$PLUGINSDIR\WebTools.UpdateHelper.exe" --check-install "$R8\."' $R9
    IfErrors update_check_failed
    IntCmp $R9 0 update_prepared check_process_result check_process_result
  check_process_result:
    IntCmp $R9 10 previous_running update_check_failed update_check_failed
  previous_running:
    IfSilent update_cancelled
    MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL "WebTools 在更新前再次启动了。点击“确定”正常退出后台并继续当前更新，点击“取消”停止安装。" IDOK prepare_previous_processes
    Goto update_cancelled
  prepare_previous_processes:
    ClearErrors
    ExecWait '"$PLUGINSDIR\WebTools.UpdateHelper.exe" --prepare-install "$R8\."' $R9
    IfErrors update_check_failed
    IntCmp $R9 0 check_previous_processes update_check_failed update_check_failed
  update_check_failed:
    IfSilent update_cancelled
    MessageBox MB_ICONSTOP|MB_RETRYCANCEL "暂时无法确认 WebTools 已退出（检测代码 $R9）。请正常退出 WebTools 后点击“重试”，会在当前安装流程中重新检测。$\r$\n$\r$\n当前尚未卸载旧版本或替换文件。" IDRETRY check_previous_processes
  update_cancelled:
    Abort
  update_prepared:
    ClearErrors
    ; _?= prevents NSIS from spawning an unwaited temporary uninstaller.
    ; It must be the final, unquoted parameter, including paths with spaces.
    ExecWait '$R3 /S _?=$R8' $R4
    IfErrors previous_failed
    IntCmp $R4 0 verify_previous_removed previous_failed previous_failed
  verify_previous_removed:
    ReadRegStr $R7 HKCU "${UNINSTALL_ROOT}\$R1" "UninstallString"
    StrCmp $R7 "" 0 previous_failed
    IfFileExists "$R8\WebTools.NativeHost.exe" previous_failed
    IfFileExists "$R8\Manager\WebTools.exe" previous_failed
    IfFileExists "$R8\WebTools.exe" previous_failed
    Goto find_previous
  previous_failed:
    IfSilent update_cancelled
    MessageBox MB_ICONSTOP|MB_RETRYCANCEL "旧版卸载尚未完成（返回代码 $R4）。点击“重试”继续当前安装，点击“取消”停止。$\r$\n$\r$\n尚未写入新版文件。" IDRETRY find_previous
    Goto update_cancelled
  update_location_failed:
    MessageBox MB_ICONSTOP|MB_OK "无法确认旧版 WebTools 的安装目录。请从 Windows 应用列表正常卸载旧版本后重试。"
    Abort
  done:
FunctionEnd

Section "Install WebTools NativeHost and Manager" SEC_INSTALL
  SetShellVarContext current
  Call RemovePreviousWebTools

  SetOutPath "$INSTDIR"
  File "stage\app.ico"
  File /r "stage\host\*.*"

  SetOutPath "$INSTDIR\Manager"
  File /r "stage\manager\*.*"

  ${If} $IsTestInstall == "1"
    FileOpen $R0 "$INSTDIR\.phase4f-test-install" w
    FileWrite $R0 "test"
    FileClose $R0
    WriteRegStr HKCU "${TEST_UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME} Phase 4F Test"
    WriteRegStr HKCU "${TEST_UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${TEST_UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  ${Else}
    ${If} $WasAutoStartEnabled == "1"
      WriteRegStr HKCU "${RUN_KEY}" "WebTools" '"$INSTDIR\WebTools.NativeHost.exe"'
    ${Else}
      DeleteRegValue HKCU "${RUN_KEY}" "WebTools"
    ${EndIf}
    CreateDirectory "$SMPROGRAMS\WebTools"
    CreateShortcut "$SMPROGRAMS\WebTools\WebTools.lnk" "$INSTDIR\WebTools.NativeHost.exe" "" "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Start WebTools Native Launcher"
    CreateShortcut "$DESKTOP\WebTools.lnk" "$INSTDIR\WebTools.NativeHost.exe" "" "$INSTDIR\app.ico" 0 SW_SHOWNORMAL "" "Start WebTools Native Launcher"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app.ico"
    WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "WebTools"
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\.phase4f-test-install" test_uninstall product_uninstall
  test_uninstall:
    DeleteRegKey HKCU "${TEST_UNINSTALL_KEY}"
    Goto remove_files
  product_uninstall:
    DeleteRegValue HKCU "${RUN_KEY}" "WebTools"
    Delete "$DESKTOP\WebTools.lnk"
    Delete "$SMPROGRAMS\WebTools\WebTools.lnk"
    RMDir "$SMPROGRAMS\WebTools"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
  remove_files:
    Delete "$INSTDIR\Uninstall.exe"
    RMDir /r "$INSTDIR"
SectionEnd
