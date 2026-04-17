import { useState, useEffect, useCallback, useRef } from 'react'

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

interface OllamaStatus {
  isRunning: boolean
  version?: string
  models: OllamaModel[]
  error?: string
  isLoading: boolean
}

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

export function useOllamaStatus(pollIntervalMs = 5000) {
  const [status, setStatus] = useState<OllamaStatus>({
    isRunning: false,
    models: [],
    isLoading: true,
  })
  const abortRef = useRef<AbortController | null>(null)

  const fetchStatus = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus((prev) => ({ ...prev, isLoading: true }))

    try {
      // Check if Ollama is running
      const versionRes = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      })

      if (!versionRes.ok) {
        setStatus({
          isRunning: false,
          models: [],
          error: `Ollama 返回错误: ${versionRes.status}`,
          isLoading: false,
        })
        return
      }

      const versionData = await versionRes.json()
      const version = versionData.version as string

      // Fetch installed models
      const tagsRes = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      })

      let models: OllamaModel[] = []
      if (tagsRes.ok) {
        const tagsData = await tagsRes.json()
        models = (tagsData.models as OllamaModel[]) ?? []
      }

      setStatus({
        isRunning: true,
        version,
        models,
        isLoading: false,
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      setStatus({
        isRunning: false,
        models: [],
        error: '无法连接到 Ollama，请确认 Ollama 是否已启动',
        isLoading: false,
      })
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, pollIntervalMs)
    return () => {
      clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [fetchStatus, pollIntervalMs])

  return {
    ...status,
    refresh: fetchStatus,
  }
}
