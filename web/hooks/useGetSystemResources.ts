import { useEffect, useState } from 'react'

import { ExtensionType } from '@janhq/core'
import { MonitoringExtension } from '@janhq/core'

import { useSetAtom } from 'jotai'

import { extensionManager } from '@/extension/ExtensionManager'
import { totalRamAtom } from '@/helpers/atoms/SystemBar.atom'

export default function useGetSystemResources() {
  const [ram, setRam] = useState<number>(0)
  const [cpu, setCPU] = useState<number>(0)
  const setTotalRam = useSetAtom(totalRamAtom)

  const getSystemResources = async () => {
    if (
      !extensionManager.get<MonitoringExtension>(ExtensionType.SystemMonitoring)
    ) {
      return
    }
    const monitoring = extensionManager.get<MonitoringExtension>(
      ExtensionType.SystemMonitoring
    )
    const resourceInfor = await monitoring?.getResourcesInfo()
    const currentLoadInfor = await monitoring?.getCurrentLoad()

    const ram =
      (resourceInfor?.mem?.active ?? 0) / (resourceInfor?.mem?.total ?? 1)
    if (resourceInfor?.mem?.total) setTotalRam(resourceInfor.mem.total)

    setRam(Math.round(ram * 100))
    setCPU(Math.round(currentLoadInfor?.currentLoad ?? 0))
  }

  useEffect(() => {
    getSystemResources()

    // Fetch interval - every 5s
    // TODO: Will we really need this?
    // There is a possibility that this will be removed and replaced by the process event hook?
    const intervalId = setInterval(() => {
      getSystemResources()
    }, 5000)

    // clean up interval
    return () => clearInterval(intervalId)
  }, [])

  return {
    totalRamAtom,
    ram,
    cpu,
  }
}
