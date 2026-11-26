import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { DeviceList } from '@/services/hardware/types'
import { useModelProvider } from './useModelProvider'

interface LlamacppDevicesStore {
  devices: (DeviceList & { activated: boolean })[]
  loading: boolean
  error: string | null

  // Actions
  fetchDevices: () => Promise<void>
  clearError: () => void
  setDevices: (devices: (DeviceList & { activated: boolean })[]) => void
  toggleDevice: (deviceId: string) => void
  // Atomically set activation for several devices (e.g. one physical GPU
  // exposed by multiple backends) and persist the result once.
  setActivations: (updates: Record<string, boolean>) => Promise<void>
}

export const useLlamacppDevices = create<LlamacppDevicesStore>((set, get) => ({
  devices: [],
  loading: false,
  error: null,

  fetchDevices: async () => {
    set({ loading: true, error: null })

    try {
      const devices = await getServiceHub().hardware().getLlamacppDevices()
      
      // Check current device setting from provider
      const { getProviderByName } = useModelProvider.getState()
      const llamacppProvider = getProviderByName('llamacpp')
      const currentDeviceSetting = llamacppProvider?.settings.find(
        (s) => s.key === 'device'
      )?.controller_props.value as string

      // Parse device setting from extension which represents activated devices
      const activatedDevices = currentDeviceSetting 
        ? currentDeviceSetting.split(',').map(d => d.trim()).filter(Boolean)
        : []

      const devicesWithActivation = devices.map((device) => ({
        ...device,
        activated:
          // Empty device setting means all devices are activated
          !currentDeviceSetting || currentDeviceSetting === '' || activatedDevices.includes(device.id),
      }))

      set({ devices: devicesWithActivation, loading: false })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch devices'
      set({ error: errorMessage, loading: false })
    }
  },

  clearError: () => set({ error: null }),

  setDevices: (devices) => set({ devices }),

  toggleDevice: async (deviceId: string) => {
    const device = get().devices.find((d) => d.id === deviceId)
    if (device) {
      await get().setActivations({ [deviceId]: !device.activated })
    }
  },

  setActivations: async (updates: Record<string, boolean>) => {
    set((state) => ({
      devices: state.devices.map((device) =>
        updates[device.id] === undefined
          ? device
          : { ...device, activated: updates[device.id] }
      ),
    }))

    const { getProviderByName, updateProvider } = useModelProvider.getState()
    const llamacppProvider = getProviderByName('llamacpp')

    if (llamacppProvider) {
      const deviceString = get()
        .devices.filter((device) => device.activated)
        .map((device) => device.id)
        .join(',')

      const updatedSettings = llamacppProvider.settings.map((setting) => {
        if (setting.key === 'device') {
          return {
            ...setting,
            controller_props: {
              ...setting.controller_props,
              value: deviceString.length > 0 ? deviceString : 'none',
            },
          }
        }
        return setting
      })

      await getServiceHub().providers().updateSettings('llamacpp', updatedSettings)
      updateProvider('llamacpp', {
        settings: updatedSettings,
      })
    }
  },
}))
