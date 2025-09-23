!macro NSIS_HOOK_POSTINSTALL
  ; Check if Visual C++ Redistributable is already installed
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
  ${If} $0 == ""
    ; Try alternative registry location
    ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
  ${EndIf}

  ${If} $0 == ""
    ; VC++ Redistributable not found, need to install
    DetailPrint "Visual C++ Redistributable not found, installing from bundled file..."

    ; Install from bundled EXE if not installed
    ${If} ${FileExists} "$INSTDIR\resources\lib\vc_redist.x64.exe"
      DetailPrint "Installing Visual C++ Redistributable..."
      ; Copy to TEMP folder and then execute installer
      CopyFiles "$INSTDIR\resources\lib\vc_redist.x64.exe" "$TEMP\vc_redist.x64.exe"
      ExecWait '"$TEMP\vc_redist.x64.exe" /quiet /norestart' $1

      ; Check whether installation process exited successfully (code 0) or not
      ${If} $1 == 0
        DetailPrint "Visual C++ Redistributable installed successfully"
      ${ElseIf} $1 == 1638
        DetailPrint "Visual C++ Redistributable already installed (newer version)"
      ${ElseIf} $1 == 3010
        DetailPrint "Visual C++ Redistributable installed successfully (restart required)"
      ${Else}
        DetailPrint "Visual C++ installation failed with exit code: $1"
      ${EndIf}

      ; Clean up setup files from TEMP and your installed app
      Delete "$TEMP\vc_redist.x64.exe"
      Delete "$INSTDIR\resources\lib\vc_redist.x64.exe"
    ${Else}
      DetailPrint "Visual C++ Redistributable not found at expected location: $INSTDIR\resources\lib\vc_redist.x64.exe"
    ${EndIf}
  ${Else}
    DetailPrint "Visual C++ Redistributable already installed (version: $0)"
  ${EndIf}

  ; ---- Copy LICENSE to install root ----
  ${If} ${FileExists} "$INSTDIR\resources\LICENSE"
    CopyFiles /SILENT "$INSTDIR\resources\LICENSE" "$INSTDIR\LICENSE"
    DetailPrint "Copied LICENSE to install root"
  ${EndIf}

  ; ---- Copy vulkan-1.dll to install root ----
  ${If} ${FileExists} "$INSTDIR\resources\lib\vulkan-1.dll"
    CopyFiles /SILENT "$INSTDIR\resources\lib\vulkan-1.dll" "$INSTDIR\vulkan-1.dll"
    DetailPrint "Copied vulkan-1.dll to install root"
    
    ; Optional cleanup - remove from resources folder
    Delete "$INSTDIR\resources\lib\vulkan-1.dll"
    ; Only remove the lib directory if it's empty after removing both files
    RMDir "$INSTDIR\resources\lib"
  ${Else}
    DetailPrint "vulkan-1.dll not found at expected location: $INSTDIR\resources\lib\vulkan-1.dll"
  ${EndIf}
!macroend