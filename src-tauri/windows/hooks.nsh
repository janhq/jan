!macro NSIS_HOOK_POSTINSTALL
  ; Check if Visual C++ Redistributable is already installed
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
  ${If} $0 == ""
    ; Try alternative registry location
    ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
  ${EndIf}

  ${If} $0 == ""
    ; VC++ Redistributable not found, need to install
    DetailPrint "Visual C++ Redistributable not found, downloading and installing..."
    
    ; Download VC++ Redistributable
    Delete "$TEMP\vc_redist.x64.exe"
    DetailPrint "Downloading Visual C++ Redistributable..."
    NSISdl::download "https://aka.ms/vs/17/release/vc_redist.x64.exe" "$TEMP\vc_redist.x64.exe"
    Pop $1
    
    ${If} $1 == "success"
      DetailPrint "Visual C++ Redistributable download successful"
      
      ; Install VC++ Redistributable silently
      DetailPrint "Installing Visual C++ Redistributable..."
      ExecWait '"$TEMP\vc_redist.x64.exe" /quiet /norestart' $2
      
      ${If} $2 == 0
        DetailPrint "Visual C++ Redistributable installed successfully"
      ${ElseIf} $2 == 1638
        DetailPrint "Visual C++ Redistributable already installed (newer version)"
      ${ElseIf} $2 == 3010
        DetailPrint "Visual C++ Redistributable installed successfully (restart required)"
      ${Else}
        DetailPrint "Visual C++ installation failed with exit code: $2"
        MessageBox MB_ICONEXCLAMATION "Visual C++ installation failed. Some features may not work."
      ${EndIf}
      
      ; Clean up downloaded file
      Delete "$TEMP\vc_redist.x64.exe"
    ${Else}
      DetailPrint "Failed to download Visual C++ Redistributable: $1"
      MessageBox MB_ICONEXCLAMATION "Failed to download Visual C++ Redistributable. Some features may not work."
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
    ; Only remove the lib directory if it's empty
    RMDir "$INSTDIR\resources\lib"
  ${Else}
    DetailPrint "vulkan-1.dll not found at expected location: $INSTDIR\resources\lib\vulkan-1.dll"
  ${EndIf}
!macroend