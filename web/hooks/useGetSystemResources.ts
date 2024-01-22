import { useEffect, useState } from 'react'

import { ExtensionTypeEnum } from '@janhq/core'
import { MonitoringExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import {
  cpuUsageAtom,
  totalRamAtom,
  usedRamAtom,
  nvidiaTotalVramAtom,
  nvidiaUsedVramAtom,
} from '@/helpers/atoms/SystemBar.atom'

export default function useGetSystemResources() {
  const [ram, setRam] = useState<number>(0)
  const [cpu, setCPU] = useState<number>(0)
  const [nvidiaGpuUsed, setNvidiaGpuUsed] = useState<number>(0)
  const [nvidiaVramUsed, setNvidiaVramUsed] = useState<number>(0)

  const setTotalRam = useSetAtom(totalRamAtom)
  const setUsedRam = useSetAtom(usedRamAtom)

  const setCpuUsage = useSetAtom(cpuUsageAtom)

  const setTotalNvidiaVram = useSetAtom(nvidiaTotalVramAtom)
  const setUsedNvidiaVram = useSetAtom(nvidiaUsedVramAtom)

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
    const currentLoadInfor = await monitoring?.getCurrentLoad()

    const ram =
      (currentLoadInfor?.mem?.usedMemory ?? 0) /
      (currentLoadInfor?.mem?.totalMemory ?? 1)
    if (currentLoadInfor?.mem?.usedMemory)
      setUsedRam(currentLoadInfor.mem.usedMemory)
    if (currentLoadInfor?.mem?.totalMemory)
      setTotalRam(currentLoadInfor.mem.totalMemory)
    if (currentLoadInfor?.nvidia?.vram_total)
      setTotalNvidiaVram(currentLoadInfor.nvidia.vram_total)
    if (currentLoadInfor?.nvidia?.vram_utilization)
      setUsedNvidiaVram(currentLoadInfor.nvidia.vram_utilization)

    setRam(Math.round(ram * 100))

    setCPU(Math.round(currentLoadInfor?.cpu?.usage ?? 0))
    setCpuUsage(Math.round(currentLoadInfor?.cpu?.usage ?? 0))

    setNvidiaGpuUsed(Math.round(currentLoadInfor?.nvidia?.gpu_utilization ?? 0))
    setNvidiaVramUsed(
      Math.round(currentLoadInfor?.nvidia?.vram_utilization ?? 0)
    )
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
    nvidiaGpuUsed,
    nvidiaVramUsed,
  }
}
