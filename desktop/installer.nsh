; Extra NSIS steps for the StackTime installer (referenced from package.json -> build.nsis.include).
; The app also registers stacktime:// itself on every launch; doing it here as well means the
; sign-in link works before the first launch and is removed again on uninstall.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\stacktime" "" "URL:StackTime"
  WriteRegStr HKCU "Software\Classes\stacktime" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\stacktime\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\stacktime"
  ; A real uninstall (not the silent one that runs during an update) also drops "Launch on startup"
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "me.stacktime.desktop"
  ${endIf}
!macroend
