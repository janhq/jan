import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { useModelProvider } from '@/hooks/useModelProvider'
import { ModelCapabilities } from '@/types/models'

export interface OllamaModel {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details?: {
    format?: string
    family?: string
    families?: string[]
    parameter_size?: string
    quantization_level?: string
  }
}

export interface InstallProgress {
  status: 'downloading' | 'installing' | 'completed' | 'error'
  progress: number
  message: string
}

interface OllamaStatus {
  isRunning: boolean
  isInstalled: boolean
  installPath?: string
  version?: string
  models: OllamaModel[]
  error?: string
  isLoading: boolean
  isInstalling: boolean
  installProgress: number
  installStatus: InstallProgress['status'] | null
  installMessage: string
}

interface OllamaRunningStatus {
  is_running: boolean
  version: string | null
  models: Array<{
    name: string
    model: string
    modified_at: string
    size: number
    digest: string
    details?: OllamaModel['details']
  }>
}

export function useOllamaStatus(pollIntervalMs = 5000) {
  const [status, setStatus] = useState<OllamaStatus>({
    isRunning: false,
    isInstalled: false,
    models: [],
    isLoading: true,
    isInstalling: false,
    installProgress: 0,
    installStatus: null,
    installMessage: '',
  })
  const unlistenRef = useRef<UnlistenFn | null>(null)
  const isRunningRef = useRef(false)

  // Check if Ollama is installed on the system (scans paths + registry)
  const checkInstalled = useCallback(async () => {
    try {
      const path = await invoke<string | null>('check_ollama_installed')
      setStatus((prev) => ({
        ...prev,
        isInstalled: !!path,
        installPath: path ?? undefined,
      }))
      return path
    } catch (error) {
      console.error('Failed to check Ollama installation:', error)
      setStatus((prev) => ({ ...prev, isInstalled: false }))
      return null
    }
  }, [])

  const syncedDigestsRef = useRef<Set<string>>(new Set())

  const fetchStatus = useCallback(async () => {
    setStatus((prev) => ({ ...prev, isLoading: true }))

    try {
      const result = await invoke<OllamaRunningStatus>('check_ollama_running')

      if (result.is_running) {
        isRunningRef.current = true
        const models = (result.models as OllamaModel[]) ?? []
        setStatus((prev) => ({
          ...prev,
          isRunning: true,
          version: result.version ?? undefined,
          models,
          isLoading: false,
          error: undefined,
        }))

        // Sync Ollama models to the global provider store so they appear
        // in the chat model dropdown.
        const currentDigests = new Set(models.map((m) => m.digest).filter(Boolean))
        const lastDigests = syncedDigestsRef.current
        const hasChanged =
          currentDigests.size !== lastDigests.size ||
          Array.from(currentDigests).some((d) => !lastDigests.has(d))

        if (hasChanged) {
          syncedDigestsRef.current = currentDigests
          const convertedModels: Model[] = models.map((m) => {
            const name = m.name
            const lower = name.toLowerCase()
            const capabilities: string[] = [ModelCapabilities.COMPLETION]
            if (lower.includes('embed') || lower.includes('nomic') || lower.includes('bge')) {
              capabilities.push(ModelCapabilities.EMBEDDINGS)
            }
            if (
              lower.includes('vision') ||
              lower.includes('vl') ||
              lower.includes('llava') ||
              lower.includes('bakllava') ||
              lower.includes('moondream') ||
              lower.includes('minicpm-v')
            ) {
              capabilities.push(ModelCapabilities.VISION)
            }
            // Heuristic: most modern instruct models support tools
            if (
              lower.includes('qwen') ||
              lower.includes('llama3') ||
              lower.includes('mistral') ||
              lower.includes('mixtral') ||
              lower.includes('gemma') ||
              lower.includes('command') ||
              lower.includes('phi4') ||
              lower.includes('phi-4')
            ) {
              capabilities.push(ModelCapabilities.TOOLS)
            }
            return {
              id: name,
              model: name,
              name: name,
              displayName: name,
              provider: 'ollama',
              capabilities,
            }
          })
          useModelProvider.getState().updateProvider('ollama', {
            models: convertedModels,
          })
        }
      } else {
        isRunningRef.current = false
        setStatus((prev) => ({
          ...prev,
          isRunning: false,
          models: [],
          isLoading: false,
          error: undefined,
        }))
        if (syncedDigestsRef.current.size > 0) {
          syncedDigestsRef.current = new Set()
          useModelProvider.getState().updateProvider('ollama', { models: [] })
        }
      }
    } catch (error) {
      console.error('Failed to check Ollama status:', error)
      isRunningRef.current = false
      setStatus((prev) => ({
        ...prev,
        isRunning: false,
        models: [],
        error: '无法连接到 Ollama，请确认 Ollama 是否已安装并运行',
        isLoading: false,
      }))
    }
  }, [])

  // Start Ollama from the detected installation path
  const startOllama = useCallback(async () => {
    const path = status.installPath
    if (!path) {
      toast.error('未找到 Ollama 安装路径')
      setStatus((prev) => ({
        ...prev,
        error: '未找到 Ollama 安装路径',
      }))
      return
    }

    setStatus((prev) => ({
      ...prev,
      isLoading: true,
      installMessage: '正在启动 Ollama...',
    }))

    const toastId = toast.loading('正在启动 Ollama，请稍候...')

    try {
      // Declarative check: if Ollama is already running (auto-start, manual, etc.),
      // don't bother starting it again — just report success.
      await fetchStatus()
      if (isRunningRef.current) {
        toast.success('Ollama 已在运行中', {
          id: toastId,
          description: '检测到本地 Ollama 服务已就绪',
        })
        return
      }

      await invoke<void>('start_ollama', { ollama_path: path })
      toast.success('启动命令已发送', {
        id: toastId,
        description: '正在等待 Ollama 服务就绪...',
      })

      // Poll status multiple times with increasing intervals
      // Total wait: 1s + 2s + 3s + 5s + 8s = ~19s of actual polling
      const pollIntervals = [1000, 2000, 3000, 5000, 8000]
      for (const interval of pollIntervals) {
        await new Promise((resolve) => setTimeout(resolve, interval))
        await fetchStatus()
        if (isRunningRef.current) {
          toast.success('Ollama 服务已就绪！', { id: toastId })
          return
        }
      }
      // If still not running after all polls
      toast.warning('Ollama 启动时间较长，请检查服务状态', { id: toastId })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('Failed to start Ollama:', msg)
      toast.error(`启动失败: ${msg}`, { id: toastId })
      setStatus((prev) => ({
        ...prev,
        isLoading: false,
        error: `启动失败: ${msg}`,
      }))
    }
  }, [status.installPath, fetchStatus])

  const installOllama = useCallback(async () => {
    // Clean up any existing listener
    if (unlistenRef.current) {
      unlistenRef.current()
      unlistenRef.current = null
    }

    setStatus((prev) => ({
      ...prev,
      isInstalling: true,
      installProgress: 0,
      installStatus: 'downloading',
      installMessage: '准备下载...',
    }))

    try {
      // Start listening for progress events
      const unlisten = await listen<InstallProgress>(
        'ollama-install-progress',
        (event) => {
          const { status, progress, message } = event.payload
          setStatus((prev) => ({
            ...prev,
            installProgress: progress,
            installStatus: status,
            installMessage: message,
          }))
        }
      )
      unlistenRef.current = unlisten

      // Call Rust command to download and install
      await invoke<void>('install_ollama')

      // Installation completed - refresh status after a short delay
      // (Ollama service might take a moment to start)
      setTimeout(() => {
        fetchStatus()
      }, 3000)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('Ollama installation failed:', msg)
      setStatus((prev) => ({
        ...prev,
        isInstalling: false,
        installStatus: 'error',
        installMessage: `安装失败: ${msg}`,
      }))
    } finally {
      // Clean up listener
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [fetchStatus])

  useEffect(() => {
    // First check if installed, then check if running
    checkInstalled().then(() => {
      fetchStatus()
    })
    const timer = setInterval(fetchStatus, pollIntervalMs)
    return () => {
      clearInterval(timer)
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [fetchStatus, pollIntervalMs, checkInstalled])

  return {
    ...status,
    refresh: fetchStatus,
    installOllama,
    startOllama,
  }
}
