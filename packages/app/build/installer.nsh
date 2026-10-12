; INS-03: preserve every existing user PATH entry and add/remove only orch's bin.
!include "WinMessages.nsh"

Function OrchTransformPath
  ; Input: $R0 current PATH, $R8 target folder, $R9 1=add / 0=remove.
  StrCpy $R1 ""
  StrCpy $R2 ""
  StrCpy $R3 0
  StrCpy $R5 0
orch_path_loop:
  StrCpy $R4 $R0 1 $R3
  StrCmp $R4 "" orch_path_last
  StrCmp $R4 ";" orch_path_entry
  StrCpy $R2 "$R2$R4"
  IntOp $R3 $R3 + 1
  Goto orch_path_loop
orch_path_entry:
  StrCmp $R2 "" orch_path_next
  StrCmp /I $R2 $R8 orch_path_match
  Call OrchAppendPathEntry
  Goto orch_path_next
orch_path_match:
  StrCpy $R5 1
  StrCmp $R9 0 orch_path_next
  Call OrchAppendPathEntry
orch_path_next:
  StrCpy $R2 ""
  IntOp $R3 $R3 + 1
  Goto orch_path_loop
orch_path_last:
  StrCmp $R2 "" orch_path_done
  StrCmp /I $R2 $R8 orch_path_last_match
  Call OrchAppendPathEntry
  Goto orch_path_done
orch_path_last_match:
  StrCpy $R5 1
  StrCmp $R9 0 orch_path_done
  Call OrchAppendPathEntry
orch_path_done:
  StrCmp $R9 0 orch_path_return
  StrCmp $R5 1 orch_path_return
  StrCmp $R1 "" 0 +2
    StrCpy $R1 $R8
  StrCmp $R1 $R8 orch_path_return
  StrCpy $R1 "$R1;$R8"
orch_path_return:
  StrCpy $R0 $R1
  Return
FunctionEnd

Function OrchAppendPathEntry
  StrCmp $R1 "" 0 +2
    StrCpy $R1 $R2
  StrCmp $R1 $R2 orch_append_done
  StrCpy $R1 "$R1;$R2"
orch_append_done:
FunctionEnd

!macro OrchUpdateUserPath ADD
  ReadRegStr $R0 HKCU "Environment" "Path"
  StrCpy $R8 "$INSTDIR\bin"
  StrCpy $R9 ${ADD}
  Call OrchTransformPath
  WriteRegExpandStr HKCU "Environment" "Path" "$R0"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment"
!macroend

!macro customInstall
  !insertmacro OrchUpdateUserPath 1
!macroend

!macro customUnInstall
  !insertmacro OrchUpdateUserPath 0
!macroend
