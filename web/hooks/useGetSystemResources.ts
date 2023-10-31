import { useEffect, useState } from 'react'
import { extensionPoints } from '@plugin'
import { SystemMonitoringService } from '@janhq/core'
import { useSetAtom } from 'jotai'
import { totalRamAtom } from '@helpers/atoms/SystemBar.atom'
import { executeSerial } from '@services/pluginService'
export default function useGetSystemResources() {
  const [ram, setRam] = useState<number>(0)
  const [cpu, setCPU] = useState<number>(0)
  const setTotalRam = useSetAtom(totalRamAtom)

  const getSystemResources = async () => {
    if (!extensionPoints.get(SystemMonitoringService.GetResourcesInfo)) {
      return
    }
    const resourceInfor = await executeSerial(
      SystemMonitoringService.GetResourcesInfo
    )
    const currentLoadInfor = await executeSerial(
      SystemMonitoringService.GetCurrentLoad
    )
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
    ram,
    cpu,
  }
}
