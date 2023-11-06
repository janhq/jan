import { useEffect, useState } from 'react'

import { PluginType } from '@janhq/core'
import { MonitoringPlugin } from '@janhq/core/lib/plugins'

import { useSetAtom } from 'jotai'

import { totalRamAtom } from '@/helpers/atoms/SystemBar.atom'
import { pluginManager } from '@/plugin/PluginManager'

export default function useGetSystemResources() {
  const [ram, setRam] = useState<number>(0)
  const [cpu, setCPU] = useState<number>(0)
  const setTotalRam = useSetAtom(totalRamAtom)

  const getSystemResources = async () => {
    if (!pluginManager.get<MonitoringPlugin>(PluginType.SystemMonitoring)) {
      return
    }
    const monitoring = pluginManager.get<MonitoringPlugin>(
      PluginType.SystemMonitoring
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

    // Fetch interval - every 3s
    const intervalId = setInterval(() => {
      getSystemResources()
    }, 5000)

    // clean up
    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    totalRamAtom,
    ram,
    cpu,
  }
}
