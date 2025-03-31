import { useMemo } from 'react'

import { ExtensionTypeEnum, HardwareManagementExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'
import useSWR from 'swr'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  cpuUsageAtom,
  ramUtilitizedAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

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
export function useGetHardwareInfo(updatePeriodically: boolean = true) {
  const setCpuUsage = useSetAtom(cpuUsageAtom)
  const setUsedRam = useSetAtom(usedRamAtom)
  const setTotalRam = useSetAtom(totalRamAtom)
  const setRamUtilitized = useSetAtom(ramUtilitizedAtom)

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
      revalidateOnReconnect: false,
      refreshInterval: updatePeriodically ? 2000 : undefined,
      onSuccess(data) {
        const usedMemory = data.ram.total - data.ram.available
        setUsedRam(usedMemory)

        setTotalRam(data.ram.total)

        const ramUtilitized = (usedMemory / data.ram.total) * 100
        setRamUtilitized(Math.round(ramUtilitized))

        setCpuUsage(Math.round(data.cpu.usage))
      },
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
