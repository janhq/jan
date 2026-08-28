import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

type AgentToolsConfigState = {
  agentToolsEnabled: boolean
  setAgentToolsEnabled: (value: boolean) => void
  /** Open the sandboxed shell's network namespace. */
  bashNetworkEnabled: boolean
  setBashNetworkEnabled: (value: boolean) => void
}

/**
 * Off by default: the toolset gives the model filesystem reach (inside the
 * isolated agent workspace) and a persistent memory, so it is opt-in.
 *
 * `bashNetworkEnabled` is separately off, because it is the one setting that
 * lets a command reach off the machine. With it off, the sandbox confines a
 * command to the workspace *and* keeps it from sending anything anywhere.
 */
export const useAgentToolsConfig = create<AgentToolsConfigState>()(
  persist(
    (set) => ({
      agentToolsEnabled: false,
      setAgentToolsEnabled: (agentToolsEnabled) => set({ agentToolsEnabled }),
      bashNetworkEnabled: false,
      setBashNetworkEnabled: (bashNetworkEnabled) => set({ bashNetworkEnabled }),
    }),
    {
      name: localStorageKey.settingAgentTools,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
    }
  )
)
