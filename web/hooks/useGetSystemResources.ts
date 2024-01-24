import { useEffect, useState } from 'react'

import { ExtensionTypeEnum, MonitoringExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  availableRamAtom,
  cpuUsageAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

export default function useGetSystemResources() {
  const [ram, setRam] = useState<number>(0)
  const [cpu, setCPU] = useState<number>(0)

  const [gpus, setGPUs] = useState<Record<string, never>[]>([])
  const setTotalRam = useSetAtom(totalRamAtom)
  const setUsedRam = useSetAtom(usedRamAtom)
  const setAvailableRam = useSetAtom(availableRamAtom)
  const setCpuUsage = useSetAtom(cpuUsageAtom)

  const getSystemResources = async () => {
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

    const ram =
      (resourceInfor?.mem?.usedMemory ?? 0) /
      (resourceInfor?.mem?.totalMemory ?? 1)
    if (resourceInfor?.mem?.usedMemory) setUsedRam(resourceInfor.mem.usedMemory)
    if (resourceInfor?.mem?.totalMemory)
      setTotalRam(resourceInfor.mem.totalMemory)

    setRam(Math.round(ram * 100))
    if (resourceInfor.mem.totalMemory && resourceInfor.mem.usedMemory)
      setAvailableRam(
        resourceInfor.mem.totalMemory - resourceInfor.mem.usedMemory
      )
    setCPU(Math.round(currentLoadInfor?.cpu?.usage ?? 0))
    setCpuUsage(Math.round(currentLoadInfor?.cpu?.usage ?? 0))
    setGPUs(currentLoadInfor?.gpu ?? [])
  }

  useEffect(() => {
    getSystemResources()

    // Fetch interval - every 0.5s
    // TODO: Will we really need this?
    // There is a possibility that this will be removed and replaced by the process event hook?
    const intervalId = setInterval(() => {
      getSystemResources()
    }, 500)

    // clean up interval
    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    totalRamAtom,
    ram,
    cpu,
    gpus,
  }
}
