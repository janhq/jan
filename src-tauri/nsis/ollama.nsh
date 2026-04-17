!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3

  ; 1. Check if Ollama is already installed via its Inno Setup registry key
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{44E83376-CE68-45EB-8FC1-393500EB558C}_is1" "DisplayName"
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{44E83376-CE68-45EB-8FC1-393500EB558C}_is1" "DisplayName"
  ${EndIf}

  ${If} $R0 != ""
    DetailPrint "Ollama already installed ($R0), skipping"
    Goto ollama_done
  ${EndIf}

  ; 2. Read configuration from bundled INI
  ReadINIStr $R1 "$INSTDIR\resources\nsis\ollama-config.ini" "Ollama" "LocalSetupPath"
  ReadINIStr $R2 "$INSTDIR\resources\nsis\ollama-config.ini" "Ollama" "DownloadUrl"
  ReadINIStr $R3 "$INSTDIR\resources\nsis\ollama-config.ini" "Ollama" "InstallDir"

  ; 3. Prefer local pre-staged installer if it exists
  ${If} $R1 != ""
  ${AndIf} ${FileExists} $R1
    DetailPrint "Using local OllamaSetup.exe: $R1"
    StrCpy $R0 $R1
    Goto do_ollama_install
  ${EndIf}

  ; 4. Otherwise download from configured URL
  ${If} $R2 == ""
    DetailPrint "No local OllamaSetup.exe found and no DownloadUrl configured"
    Goto ollama_done
  ${EndIf}

  DetailPrint "Downloading Ollama from $R2 ..."
  Delete "$TEMP\OllamaSetup.exe"
  NSISdl::download $R2 "$TEMP\OllamaSetup.exe"
  Pop $R0
  ${If} $R0 != "success"
    DetailPrint "Ollama download failed: $R0"
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_YESNO "Failed to download Ollama. Continue without Ollama?" IDYES continue_without_ollama_dl
      Abort "Installation cancelled due to Ollama download failure"
      continue_without_ollama_dl:
    ${Else}
      DetailPrint "Silent mode: continuing without Ollama"
    ${EndIf}
    Goto ollama_done
  ${EndIf}
  StrCpy $R0 "$TEMP\OllamaSetup.exe"

do_ollama_install:
  ; Build command line (silent + optional custom directory)
  ${If} $R3 != ""
    DetailPrint "Installing Ollama silently to $R3 ..."
    ExecWait '"$R0" /S /DIR="$R3"' $R1
  ${Else}
    DetailPrint "Installing Ollama silently with default directory ..."
    ExecWait '"$R0" /S' $R1
  ${EndIf}

  ; Clean up temp download
  ${If} $R0 == "$TEMP\OllamaSetup.exe"
    Delete "$TEMP\OllamaSetup.exe"
  ${EndIf}

  ${If} $R1 = 0
    DetailPrint "Ollama installed successfully"
  ${Else}
    DetailPrint "Ollama installation failed with exit code: $R1"
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_YESNO "Ollama installation failed. Continue without Ollama?" IDYES continue_without_ollama
      Abort "Installation cancelled due to Ollama installation failure"
      continue_without_ollama:
    ${Else}
      DetailPrint "Silent mode: continuing without Ollama"
    ${EndIf}
  ${EndIf}

ollama_done:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
