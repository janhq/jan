import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { backendStorage } from '@/lib/backendStorage'

type CoworkConfigState = {
  /**
   * Open the sandboxed shell's network namespace for Cowork runs. On by
   * default: an agent surface without package installs or curl is crippled
   * for the work it exists to do, and the OS sandbox still confines the
   * filesystem either way. Chat's shell is unaffected — its network is closed
   * unconditionally.
   */
  networkEnabled: boolean
  setNetworkEnabled: (value: boolean) => void
}

export const useCoworkConfig = create<CoworkConfigState>()(
  persist(
    (set) => ({
      networkEnabled: true,
      setNetworkEnabled: (networkEnabled) => set({ networkEnabled }),
    }),
    {
      name: localStorageKey.settingCowork,
      storage: createJSONStorage(() => backendStorage),
      skipHydration: true,
    }
  )
)
