!macro NSIS_HOOK_PREINSTALL
  ; RiftHelper relaunches itself elevated (admin) to satisfy the OBS game
  ; capture hook, so a normal installer cannot overwrite the running exe.
  ; This installer requests admin permission, so taskkill can also terminate
  ; the elevated RiftHelper process. Ignore failures when it is not running.
  nsExec::ExecToStack 'taskkill /F /IM rifthelper-desktop.exe >nul 2>&1'
  Pop $0
  ; Give Windows a moment to release the locked file handles after the kill so
  ; the file copy below does not hit a sharing-violation error.
  Sleep 750
!macroend
