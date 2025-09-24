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

  ; ---- Install Vulkan Runtime if not present ----
  ; Check if Vulkan Runtime is installed (registry key exists)
  ReadRegStr $2 HKLM "SOFTWARE\Khronos\Vulkan\InstalledVersions" ""
  ${If} $2 == ""
    ReadRegStr $2 HKLM "SOFTWARE\WOW6432Node\Khronos\Vulkan\InstalledVersions" ""
  ${EndIf}

  ${If} $2 == ""
    DetailPrint "Vulkan Runtime not found, installing from bundled file..."

    ${If} ${FileExists} "$INSTDIR\resources\lib\VulkanRT-X64-1.4.321.0-Installer.exe"
      DetailPrint "Installing Vulkan Runtime..."
      CopyFiles "$INSTDIR\resources\lib\VulkanRT-X64-1.4.321.0-Installer.exe" "$TEMP\VulkanRT-X64-1.4.321.0-Installer.exe"
      ExecWait '"$TEMP\VulkanRT-X64-1.4.321.0-Installer.exe" /quiet /norestart' $3

      ${If} $3 == 0
        DetailPrint "Vulkan Runtime installed successfully"
      ${Else}
        DetailPrint "Vulkan Runtime installation failed with exit code: $3"
      ${EndIf}

      Delete "$TEMP\VulkanRT-X64-1.4.321.0-Installer.exe"
      Delete "$INSTDIR\resources\lib\VulkanRT-X64-1.4.321.0-Installer.exe"
    ${Else}
      DetailPrint "Vulkan Runtime installer not found at expected location: $INSTDIR\resources\lib\VulkanRT-X64-1.4.321.0-Installer.exe"
    ${EndIf}
  ${Else}
    DetailPrint "Vulkan Runtime already installed"
  ${EndIf}

  ; ---- Copy LICENSE to install root ----
  ${If} ${FileExists} "$INSTDIR\resources\LICENSE"
    CopyFiles /SILENT "$INSTDIR\resources\LICENSE" "$INSTDIR\LICENSE"
    DetailPrint "Copied LICENSE to install root"

    ; Optional cleanup - remove from resources folder
    Delete "$INSTDIR\resources\LICENSE"
  ${Else}
    DetailPrint "LICENSE not found at expected location: $INSTDIR\resources\LICENSE"
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