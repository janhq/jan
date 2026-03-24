/**
 * Store for model lifecycle features: idle auto-unload and post-tool-call unload.
 * Tracks last user activity (message send) so the idle-unload timer can run.
 */
import { create } from 'zustand'
import { useAppState } from '@/hooks/useAppState'
import type { ServiceHub } from '@/services'

export const LOCAL_PROVIDERS = new Set(['llamacpp', 'mlx'])

export function getProviderSetting(
  provider: ModelProvider | undefined,
  key: string
): number | boolean | undefined {
  const setting = provider?.settings?.find((s) => s.key === key)
  return (setting?.controller_props as { value?: number | boolean })?.value
}

/**
 * Sync the global activeModels UI state with the engine's actual loaded models.
 * Call after any load/unload operation to keep the UI in sync.
 */
export async function syncActiveModels(serviceHub: ServiceHub): Promise<void> {
  try {
    const models = await serviceHub.models().getActiveModels()
    useAppState.getState().setActiveModels(models || [])
  } catch (err) {
    console.warn('[ModelLifecycle] syncActiveModels failed:', err)
  }
}

interface ModelLifecycleState {
  /** Timestamp (ms) of last user-initiated activity (e.g. sending a message). */
  lastActivityAt: number
  /** Update last activity to now. Call when the user sends a message. */
  setLastActivity: () => void
  /** Reset activity timestamp. Call after idle unload to prevent premature re-unload. */
  resetActivity: () => void
}

export const useModelLifecycleStore = create<ModelLifecycleState>((set) => ({
  lastActivityAt: Date.now(),
  setLastActivity: () => set({ lastActivityAt: Date.now() }),
  resetActivity: () => set({ lastActivityAt: Date.now() }),
}))
