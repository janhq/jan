import { create } from 'zustand'
import { getLlamacppDevices, DeviceList } from '@/services/hardware'
import { updateSettings } from '@/services/providers'
import { useModelProvider } from './useModelProvider'

interface LlamacppDevicesStore {
  devices: DeviceList[]
  loading: boolean
  error: string | null
  activatedDevices: Set<string> // Track which devices are activated

  // Actions
  fetchDevices: () => Promise<void>
  clearError: () => void
  setDevices: (devices: DeviceList[]) => void
  toggleDevice: (deviceId: string) => void
  setActivatedDevices: (deviceIds: string[]) => void
}

export const useLlamacppDevices = create<LlamacppDevicesStore>((set, get) => ({
  devices: [],
  loading: false,
  error: null,
  activatedDevices: new Set(),

  fetchDevices: async () => {
    set({ loading: true, error: null })

    try {
      const devices = await getLlamacppDevices()
      set({ devices, loading: false })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch devices'
      set({ error: errorMessage, loading: false })
    }
  },

  clearError: () => set({ error: null }),

  setDevices: (devices) => set({ devices }),

  toggleDevice: async (deviceId: string) => {
    set((state) => {
      const newActivatedDevices = new Set(state.activatedDevices)
      if (newActivatedDevices.has(deviceId)) {
        newActivatedDevices.delete(deviceId)
      } else {
        newActivatedDevices.add(deviceId)
      }
      return { activatedDevices: newActivatedDevices }
    })

    // Update llamacpp provider settings
    const { getProviderByName, updateProvider } = useModelProvider.getState()
    const llamacppProvider = getProviderByName('llamacpp')

    if (llamacppProvider) {
      const deviceString = Array.from(get().activatedDevices).join(',')

      const updatedSettings = llamacppProvider.settings.map((setting) => {
        if (setting.key === 'device') {
          return {
            ...setting,
            controller_props: {
              ...setting.controller_props,
              value: deviceString,
            },
          }
        }
        return setting
      })

      await updateSettings('llamacpp', updatedSettings)
      updateProvider('llamacpp', {
        settings: updatedSettings,
      })
    }
  },

  setActivatedDevices: (deviceIds: string[]) => {
    set({ activatedDevices: new Set(deviceIds) })
  },
}))
