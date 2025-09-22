!macro NSIS_HOOK_POSTINSTALL
  ; Check if Visual C++ 2019 Redistributable is installed (via Windows Registry)
  ReadRegDWord $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"

  ${If} $0 == 1
    DetailPrint "Visual C++ Redistributable already installed"
    Goto vcredist_done
  ${EndIf}

  ; Install from bundled MSI if not installed
  ${If} ${FileExists} "$INSTDIR\resources\vc_redist.x64.msi"
    DetailPrint "Installing Visual C++ Redistributable..."
    ; Copy to TEMP folder and then execute installer
    CopyFiles "$INSTDIR\resources\vc_redist.x64.msi" "$TEMP\vc_redist.x64.msi"
    ExecWait 'msiexec /i "$TEMP\vc_redist.x64.msi" /passive /norestart' $0

    ; Check wether installation process exited successfully (code 0) or not
    ${If} $0 == 0
      DetailPrint "Visual C++ Redistributable installed successfully"
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Visual C++ installation failed. Some features may not work."
    ${EndIf}

    ; Clean up setup files from TEMP and your installed app
    Delete "$TEMP\vc_redist.x64.msi"
    Delete "$INSTDIR\resources\vc_redist.x64.msi"
  ${EndIf}

  vcredist_done:
!macroend