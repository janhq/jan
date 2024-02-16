import { useCallback, useEffect, useState } from 'react'

import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  cpuUsageAtom,
  totalRamAtom,
  usedRamAtom,
  nvidiaTotalVramAtom,
  gpusAtom,
  ramUtilitizedAtom,
} from '@/helpers/atoms/SystemBar.atom'

export default function useGetSystemResources() {
  const [intervalId, setIntervalId] = useState<
    NodeJS.Timeout | number | undefined
  >(undefined)

  const setTotalRam = useSetAtom(totalRamAtom)
  const setGpus = useSetAtom(gpusAtom)
  const setUsedRam = useSetAtom(usedRamAtom)
  const setCpuUsage = useSetAtom(cpuUsageAtom)
  const setTotalNvidiaVram = useSetAtom(nvidiaTotalVramAtom)
  const setRamUtilitized = useSetAtom(ramUtilitizedAtom)

  const getSystemResources = useCallback(async () => {
    if (
      !extensionManager.get<MonitoringExtension>(
        ExtensionTypeEnum.SystemMonitoring
      )
    ) {
      return
    }
    const monitoring = extensionManager.get<MonitoringExtension>(
      ExtensionTypeEnum.SystemMonitoring
    )
    const resourceInfor = await monitoring?.getResourcesInfo()
    const currentLoadInfor = await monitoring?.getCurrentLoad()

    if (resourceInfor?.mem?.usedMemory) setUsedRam(resourceInfor.mem.usedMemory)
    if (resourceInfor?.mem?.totalMemory)
      setTotalRam(resourceInfor.mem.totalMemory)

    const ramUtilitized =
      ((resourceInfor?.mem?.usedMemory ?? 0) /
        (resourceInfor?.mem?.totalMemory ?? 1)) *
      100
    setRamUtilitized(Math.round(ramUtilitized))

    setCpuUsage(Math.round(currentLoadInfor?.cpu?.usage ?? 0))

    const gpus = currentLoadInfor?.gpu ?? []
    setGpus(gpus)

    let totalNvidiaVram = 0
    if (gpus.length > 0) {
      totalNvidiaVram = gpus.reduce(
        (total: number, gpu: { memoryTotal: string }) =>
          total + Number(gpu.memoryTotal),
        0
      )
    }
    setTotalNvidiaVram(totalNvidiaVram)
  }, [
    setUsedRam,
    setTotalRam,
    setRamUtilitized,
    setCpuUsage,
    setGpus,
    setTotalNvidiaVram,
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
     * Fetch resource informations once
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
