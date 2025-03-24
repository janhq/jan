/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react'

import { ExtensionTypeEnum, HardwareManagementExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  cpuUsageAtom,
  totalRamAtom,
  usedRamAtom,
  nvidiaTotalVramAtom,
  gpusAtom,
  ramUtilitizedAtom,
  availableVramAtom,
} from '@/helpers/atoms/SystemBar.atom'

export default function useGetSystemResources() {
  const [intervalId, setIntervalId] = useState<
    NodeJS.Timeout | number | undefined
  >(undefined)

  const setGpus = useSetAtom(gpusAtom)
  const setCpuUsage = useSetAtom(cpuUsageAtom)
  const setTotalNvidiaVram = useSetAtom(nvidiaTotalVramAtom)
  const setAvailableVram = useSetAtom(availableVramAtom)
  const setUsedRam = useSetAtom(usedRamAtom)
  const setTotalRam = useSetAtom(totalRamAtom)
  const setRamUtilitized = useSetAtom(ramUtilitizedAtom)

  const getSystemResources = useCallback(async () => {
    if (
      !extensionManager.get<HardwareManagementExtension>(
        ExtensionTypeEnum.Hardware
      )
    ) {
      return
    }

    const hardwareExtension = extensionManager.get<HardwareManagementExtension>(
      ExtensionTypeEnum.Hardware
    )

    const hardwareInfo = await hardwareExtension?.getHardware()

    const usedMemory =
      Number(hardwareInfo?.ram.total) - Number(hardwareInfo?.ram.available)

    if (hardwareInfo?.ram?.total && hardwareInfo?.ram?.available)
      setUsedRam(Number(usedMemory))

    if (hardwareInfo?.ram?.total) setTotalRam(hardwareInfo.ram.total)

    const ramUtilitized =
      ((Number(usedMemory) ?? 0) / (hardwareInfo?.ram.total ?? 1)) * 100

    setRamUtilitized(Math.round(ramUtilitized))

    setCpuUsage(Math.round(hardwareInfo?.cpu.usage ?? 0))

    const gpus = hardwareInfo?.gpus ?? []
    setGpus(gpus as any)

    let totalNvidiaVram = 0
    if (gpus.length > 0) {
      totalNvidiaVram = gpus.reduce(
        (total: number, gpu: { total_vram: number }) =>
          total + Number(gpu.total_vram),
        0
      )
    }

    setTotalNvidiaVram(totalNvidiaVram)

    setAvailableVram(
      gpus.reduce((total, gpu) => {
        return total + Number(gpu.free_vram || 0)
      }, 0)
    )
  }, [
    setUsedRam,
    setTotalRam,
    setRamUtilitized,
    setCpuUsage,
    setGpus,
    setTotalNvidiaVram,
    setAvailableVram,
  ])

  const watch = () => {
    getSystemResources()

    // Fetch interval - every 2s
    const itv = setInterval(() => {
      getSystemResources()
    }, 2000)
    setIntervalId(itv)
  }
  const stopWatching = useCallback(() => {
    if (intervalId) clearInterval(intervalId)
  }, [intervalId])

  useEffect(() => {
    getSystemResources()
    // Component did unmount
    // Stop watching if any
    return () => {
      stopWatching()
    }
  }, [getSystemResources, stopWatching])

  return {
    /**
     * Fetch resource information once
     */
    getSystemResources,
    /**
     *  Fetch & watch for resource update
     */
    watch,
    /**
     *  Stop watching
     */
    stopWatching,
  }
}
