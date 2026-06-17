; "Open in Xterax" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXterax" "" "Open in Xterax"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXterax" "Icon" '"$INSTDIR\xterax.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXterax" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInXterax\command" "" '"$INSTDIR\xterax.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXterax" "" "Open in Xterax"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXterax" "Icon" '"$INSTDIR\xterax.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXterax" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInXterax\command" "" '"$INSTDIR\xterax.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXterax" "" "Open in Xterax"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXterax" "Icon" '"$INSTDIR\xterax.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXterax" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInXterax\command" "" '"$INSTDIR\xterax.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInXterax"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInXterax"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInXterax"
!macroend
