import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

type ChatShellState = {
  /**
   * Whether the main chat offers the model its sandboxed shell. On by default,
   * since the sandbox confines it; but a command runner is something a user must
   * be able to refuse outright (#9222), so it is a switch and not a given.
   * Cowork owns its own tool set and does not read this.
   */
  shellEnabled: boolean
  setShellEnabled: (value: boolean) => void
}

export const useChatShell = create<ChatShellState>()(
  persist(
    (set) => ({
      shellEnabled: true,
      setShellEnabled: (shellEnabled) => set({ shellEnabled }),
    }),
    {
      name: localStorageKey.settingChatShell,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
    }
  )
)
