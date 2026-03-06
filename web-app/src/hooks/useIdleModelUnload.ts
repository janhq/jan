/**
 * Hook for idle auto-unload: unloads the current local model after a configurable
 * period of no user messages. Respects provider setting idle_unload_timeout_minutes
 * (0 = disabled). Only runs for local providers (llamacpp, mlx).
 */
import { useEffect, useRef } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  useModelLifecycleStore,
  LOCAL_PROVIDERS,
  getProviderSetting,
} from '@/stores/model-lifecycle-store'
import { getServiceHub } from '@/hooks/useServiceHub'

const CHECK_INTERVAL_MS = 60_000 // 1 minute

export function useIdleModelUnload() {
  const selectedProvider = useModelProvider((s) => s.selectedProvider)
  const getProviderByName = useModelProvider((s) => s.getProviderByName)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!LOCAL_PROVIDERS.has(selectedProvider)) return

    const provider = getProviderByName(selectedProvider)
    const timeoutMinutes = getProviderSetting(
      provider,
      'idle_unload_timeout_minutes'
    ) as number | undefined
    const timeoutMs =
      typeof timeoutMinutes === 'number' && timeoutMinutes > 0
        ? timeoutMinutes * 60 * 1000
        : 0

    if (timeoutMs === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const serviceHub = getServiceHub()
    const check = () => {
      const { lastActivityAt, resetActivity } =
        useModelLifecycleStore.getState()
      const now = Date.now()
      const modelId = useModelProvider.getState().selectedModel?.id
      if (now - lastActivityAt >= timeoutMs && modelId) {
        serviceHub
          .models()
          .stopModel(modelId, selectedProvider)
          .catch((err) =>
            console.warn('[IdleModelUnload] stopModel failed:', err)
          )
        // Reset activity so subsequent ticks don't immediately re-unload
        // when the user loads a model again without sending a message.
        resetActivity()
      }
    }

    intervalRef.current = setInterval(check, CHECK_INTERVAL_MS)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [selectedProvider, getProviderByName])
}
