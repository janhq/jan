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
    DetailPrint "检测到 Ollama 已安装 ($R0)，跳过安装"
    Goto ollama_done
  ${EndIf}

  ; 2. Read configuration from bundled INI
  ReadINIStr $R1 "$INSTDIR\resources\nsis\ollama-config.ini" "Ollama" "LocalSetupPath"
  ReadINIStr $R2 "$INSTDIR\resources\nsis\ollama-config.ini" "Ollama" "DownloadUrl"
  ReadINIStr $R3 "$INSTDIR\resources\nsis\ollama-config.ini" "Ollama" "InstallDir"

  ; 3. Prefer local pre-staged installer if it exists
  ${If} $R1 != ""
  ${AndIf} ${FileExists} $R1
    DetailPrint "使用本地 OllamaSetup.exe: $R1"
    StrCpy $R0 $R1
    Goto do_ollama_install
  ${EndIf}

  ; 4. Otherwise download from configured URL
  ${If} $R2 == ""
    DetailPrint "未找到本地 OllamaSetup.exe，且未配置下载地址"
    Goto ollama_done
  ${EndIf}

  DetailPrint "正在从 $R2 下载 Ollama ..."
  Delete "$TEMP\OllamaSetup.exe"
  NSISdl::download $R2 "$TEMP\OllamaSetup.exe"
  Pop $R0
  ${If} $R0 != "success"
    DetailPrint "Ollama 下载失败: $R0"
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_YESNO "Ollama 下载失败。是否继续安装（不安装 Ollama）？" IDYES continue_without_ollama_dl
      Abort "因 Ollama 下载失败，安装已取消"
      continue_without_ollama_dl:
    ${Else}
      DetailPrint "静默模式：跳过 Ollama，继续安装"
    ${EndIf}
    Goto ollama_done
  ${EndIf}
  StrCpy $R0 "$TEMP\OllamaSetup.exe"

do_ollama_install:
  ; Build command line (silent + optional custom directory)
  ${If} $R3 != ""
    DetailPrint "正在静默安装 Ollama 到 $R3 ..."
    ExecWait '"$R0" /S /DIR="$R3"' $R1
  ${Else}
    DetailPrint "正在静默安装 Ollama（使用默认目录）..."
    ExecWait '"$R0" /S' $R1
  ${EndIf}

  ; Clean up temp download
  ${If} $R0 == "$TEMP\OllamaSetup.exe"
    Delete "$TEMP\OllamaSetup.exe"
  ${EndIf}

  ${If} $R1 = 0
    DetailPrint "Ollama 安装成功"
  ${Else}
    DetailPrint "Ollama 安装失败，退出代码: $R1"
    ${IfNot} ${Silent}
      MessageBox MB_ICONEXCLAMATION|MB_YESNO "Ollama 安装失败。是否继续安装（不安装 Ollama）？" IDYES continue_without_ollama
      Abort "因 Ollama 安装失败，安装已取消"
      continue_without_ollama:
    ${Else}
      DetailPrint "静默模式：跳过 Ollama，继续安装"
    ${EndIf}
  ${EndIf}

ollama_done:
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
