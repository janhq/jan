import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { logError, logInfo } from '@/lib/logger'

export type OllamaLifecyclePhase =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'

interface UseOllamaLifecycleControllerOptions {
  isInstalled: boolean
  isRunning: boolean
  refresh: () => Promise<void> | void
}

export function useOllamaLifecycleController({
  isInstalled,
  isRunning,
  refresh,
}: UseOllamaLifecycleControllerOptions) {
  const [phase, setPhase] = useState<OllamaLifecyclePhase>(
    isRunning ? 'running' : 'stopped'
  )
  const [desiredRunning, setDesiredRunningState] = useState(isRunning)
  const [errorMessage, setErrorMessage] = useState<string>()
  const [isReconciling, setIsReconciling] = useState(false)
  const lastStableRunningRef = useRef(isRunning)

  useEffect(() => {
    if (isReconciling) return

    lastStableRunningRef.current = isRunning
    setDesiredRunningState(isRunning)
    setPhase(isRunning ? 'running' : 'stopped')
    setErrorMessage(undefined)
  }, [isRunning])

  const setDesiredRunning = async (next: boolean) => {
    if (isReconciling) return

    if (next && !isInstalled) {
      setPhase('error')
      setDesiredRunningState(false)
      setErrorMessage('Ollama 尚未安装，无法进入运行状态')
      return
    }

    setDesiredRunningState(next)
    setPhase(next ? 'starting' : 'stopping')
    setErrorMessage(undefined)
    setIsReconciling(true)

    logInfo(`Requested Ollama desired state: ${next ? 'running' : 'stopped'}`, {
      url: window.location.href,
    })

    try {
      await invoke(next ? 'ensure_ollama_running' : 'ensure_ollama_stopped')
      await refresh()
      lastStableRunningRef.current = next
      setDesiredRunningState(next)
      setPhase(next ? 'running' : 'stopped')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logError(`Ollama reconciliation failed: desired=${next ? 'running' : 'stopped'}`, {
        url: window.location.href,
        message,
      })

      setDesiredRunningState(lastStableRunningRef.current)
      setPhase('error')
      setErrorMessage(
        message.includes('higher privileges') ||
          message.toLowerCase().includes('access is denied')
          ? message
          : '未达到期望状态'
      )
      await refresh()
    } finally {
      setIsReconciling(false)
    }
  }

  return {
    desiredRunning,
    phase,
    errorMessage,
    isReconciling,
    switchChecked:
      phase === 'starting'
        ? true
        : phase === 'stopping'
          ? false
          : desiredRunning,
    switchDisabled: isReconciling,
    setDesiredRunning,
  }
}
