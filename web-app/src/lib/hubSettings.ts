import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

export const DEFAULT_HF_MIRROR_BASE = 'https://hf-mirror.com'

type HubSettingsState = {
  /** HF 镜像域名(搜索/详情/下载共用),可在设置页修改 */
  hfMirrorBase: string
  setHfMirrorBase: (base: string) => void
  resetHfMirrorBase: () => void
}

export const useHubSettings = create<HubSettingsState>()(
  persist(
    (set) => ({
      hfMirrorBase: DEFAULT_HF_MIRROR_BASE,
      setHfMirrorBase: (base) =>
        set({ hfMirrorBase: (base ?? '').trim() || DEFAULT_HF_MIRROR_BASE }),
      resetHfMirrorBase: () => set({ hfMirrorBase: DEFAULT_HF_MIRROR_BASE }),
    }),
    {
      name: localStorageKey.settingHub,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
    }
  )
)
