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
export function useGetHardwareInfo() {
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
      refreshInterval: 2000,
    }
  )

  const usedMemory =
    Number(hardware?.ram.total) - Number(hardware?.ram.available)

  if (hardware?.ram?.total && hardware?.ram?.available)
    setUsedRam(Number(usedMemory))

  if (hardware?.ram?.total) setTotalRam(hardware.ram.total)

  const ramUtilitized =
    ((Number(usedMemory) ?? 0) / (hardware?.ram.total ?? 1)) * 100

  setRamUtilitized(Math.round(ramUtilitized))

  setCpuUsage(Math.round(hardware?.cpu.usage ?? 0))

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
