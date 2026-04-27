import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

interface VulkanStore {
  // Vulkan state
  vulkanEnabled: boolean

  // Update functions
  setVulkanEnabled: (enabled: boolean) => void
  toggleVulkan: () => void
}

export const useVulkan = create<VulkanStore>()(
  persist(
    (set) => ({
      vulkanEnabled: false,

      setVulkanEnabled: (enabled) =>
        set({
          vulkanEnabled: enabled,
        }),

      toggleVulkan: () =>
        set((state) => ({
          vulkanEnabled: !state.vulkanEnabled,
        })),
    }),
    {
      name: localStorageKey.settingVulkan,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
