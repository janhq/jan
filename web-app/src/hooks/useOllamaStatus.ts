import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'

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
  version?: string
  models: OllamaModel[]
  error?: string
  isLoading: boolean
  isInstalling: boolean
  installProgress: number
  installStatus: InstallProgress['status'] | null
  installMessage: string
}

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

export function useOllamaStatus(pollIntervalMs = 5000) {
  const [status, setStatus] = useState<OllamaStatus>({
    isRunning: false,
    models: [],
    isLoading: true,
    isInstalling: false,
    installProgress: 0,
    installStatus: null,
    installMessage: '',
  })
  const abortRef = useRef<AbortController | null>(null)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  const fetchStatus = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus((prev) => ({ ...prev, isLoading: true }))

    try {
      const versionRes = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      })

      if (!versionRes.ok) {
        setStatus((prev) => ({
          ...prev,
          isRunning: false,
          models: [],
          error: `Ollama 返回错误: ${versionRes.status}`,
          isLoading: false,
        }))
        return
      }

      const versionData = await versionRes.json()
      const version = versionData.version as string

      const tagsRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      })

      let models: OllamaModel[] = []
      if (tagsRes.ok) {
        const tagsData = await tagsRes.json()
        models = (tagsData.models as OllamaModel[]) ?? []
      }

      setStatus((prev) => ({
        ...prev,
        isRunning: true,
        version,
        models,
        isLoading: false,
        error: undefined,
      }))
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setStatus((prev) => ({
        ...prev,
        isRunning: false,
        models: [],
        error: '无法连接到 Ollama，请确认 Ollama 是否已安装并运行',
        isLoading: false,
      }))
    }
  }, [])

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
    fetchStatus()
    const timer = setInterval(fetchStatus, pollIntervalMs)
    return () => {
      clearInterval(timer)
      abortRef.current?.abort()
      if (unlistenRef.current) {
        unlistenRef.current()
        unlistenRef.current = null
      }
    }
  }, [fetchStatus, pollIntervalMs])

  return {
    ...status,
    refresh: fetchStatus,
    installOllama,
  }
}
