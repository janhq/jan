import { useMemo } from 'react'

import { ExtensionTypeEnum, HardwareManagementExtension } from '@janhq/core'

import useSWR from 'swr'

import { extensionManager } from '@/extension/ExtensionManager'

// fetcher function
async function fetchExtensionData<T>(
  extension: HardwareManagementExtension | null,
  method: (extension: HardwareManagementExtension) => Promise<T>
): Promise<T> {
  if (!extension) {
    throw new Error('Extension not found')
  }
  return method(extension)
}

const getExtension = () =>
  extensionManager.get<HardwareManagementExtension>(
    ExtensionTypeEnum.Hardware
  ) ?? null

/**
 * @returns A Promise that resolves to an object of list engines.
 */
export function useGetHardwareInfo() {
  const extension = useMemo(
    () =>
      extensionManager.get<HardwareManagementExtension>(
        ExtensionTypeEnum.Hardware
      ) ?? null,
    []
  )

  const {
    data: hardware,
    error,
    mutate,
  } = useSWR(
    extension ? 'hardware' : null,
    () => fetchExtensionData(extension, (ext) => ext.getHardware()),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: 5000, // Poll every 5 seconds
      refreshWhenHidden: false, // Optional: Prevent polling when the tab is not visible
    }
  )

  return { hardware, error, mutate }
}

/**
 * set gpus activate
 * @returns A Promise that resolves set gpus activate.
 */
export const setActiveGpus = async (data: { gpus: number[] }) => {
  const extension = getExtension()

  if (!extension) {
    throw new Error('Extension is not available')
  }

  try {
    const response = await extension.setAvtiveGpu(data)
    return response
  } catch (error) {
    console.error('Failed to install engine variant:', error)
    throw error
  }
}
