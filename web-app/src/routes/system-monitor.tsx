import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useHardware } from '@/hooks/useHardware'
import { getHardwareInfo } from '@/services/hardware'
import { Progress } from '@/components/ui/progress'
import type { HardwareData } from '@/hooks/useHardware'
import { route } from '@/constants/routes'
import { formatDuration, formatMegaBytes } from '@/lib/utils'
import { IconDeviceDesktopAnalytics } from '@tabler/icons-react'
import { getActiveModels, stopModel } from '@/services/models'
import { ActiveModel } from '@/types/models'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.systemMonitor as any)({
  component: SystemMonitor,
})

function SystemMonitor() {
  const { t } = useTranslation()
  const { hardwareData, setHardwareData, updateCPUUsage, updateRAMAvailable } =
    useHardware()
  const [activeModels, setActiveModels] = useState<ActiveModel[]>([])

  useEffect(() => {
    // Initial data fetch
    getHardwareInfo().then((data) => {
      setHardwareData(data as unknown as HardwareData)
    })
    getActiveModels().then(setActiveModels)

    // Set up interval for real-time updates
    const intervalId = setInterval(() => {
      getHardwareInfo().then((data) => {
        setHardwareData(data as unknown as HardwareData)
        updateCPUUsage(data.cpu?.usage)
        updateRAMAvailable(data.ram?.available)
      })
      getActiveModels().then(setActiveModels)
    }, 5000)

    return () => clearInterval(intervalId)
  }, [setHardwareData, setActiveModels, updateCPUUsage, updateRAMAvailable])

  const stopRunningModel = (modelId: string) => {
    stopModel(modelId)
      .then(() => {
        setActiveModels((prevModels) =>
          prevModels.filter((model) => model.id !== modelId)
        )
      })
      .catch((error) => {
        console.error('Error stopping model:', error)
      })
  }

  // Calculate RAM usage percentage
  const ramUsagePercentage =
    ((hardwareData.ram.total - hardwareData.ram.available) /
      hardwareData.ram.total) *
    100

  return (
    <div className="flex flex-col h-full bg-main-view overflow-y-auto p-6">
      <div className="flex items-center mb-4 gap-2">
        <IconDeviceDesktopAnalytics className="text-main-view-fg/80 size-6" />
        <h1 className="text-xl font-bold text-main-view-fg">
          {t('system-monitor:title')}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CPU Usage Card */}
        <div className="bg-main-view-fg/2 rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-semibold text-main-view-fg mb-4">
            {t('system-monitor:cpuUsage')}
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:model')}
              </span>
              <span className="text-main-view-fg">
                {hardwareData.cpu.model}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:cores')}
              </span>
              <span className="text-main-view-fg">
                {hardwareData.cpu.cores}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:architecture')}
              </span>
              <span className="text-main-view-fg">{hardwareData.cpu.arch}</span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-main-view-fg/70">
                  {t('system-monitor:currentUsage')}
                </span>
                <span className="text-main-view-fg font-bold">
                  {hardwareData.cpu.usage.toFixed(2)}%
                </span>
              </div>
              <Progress value={hardwareData.cpu.usage} className="h-3 w-full" />
            </div>
          </div>
        </div>

        {/* RAM Usage Card */}
        <div className="bg-main-view-fg/2 rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-semibold text-main-view-fg mb-4">
            {t('system-monitor:memoryUsage')}
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:totalRam')}
              </span>
              <span className="text-main-view-fg">
                {formatMegaBytes(hardwareData.ram.total)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:availableRam')}
              </span>
              <span className="text-main-view-fg">
                {formatMegaBytes(hardwareData.ram.available)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:usedRam')}
              </span>
              <span className="text-main-view-fg">
                {formatMegaBytes(
                  hardwareData.ram.total - hardwareData.ram.available
                )}
              </span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-main-view-fg/70">
                  {t('system-monitor:currentUsage')}
                </span>
                <span className="text-main-view-fg font-bold">
                  {ramUsagePercentage.toFixed(2)}%
                </span>
              </div>
              <Progress value={ramUsagePercentage} className="h-3 w-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Current Active Model Section */}
      <div className="mt-6 bg-main-view-fg/2 rounded-lg p-6 shadow-sm">
        <h2 className="text-base font-semibold text-main-view-fg mb-4">
          {t('system-monitor:runningModels')}
        </h2>
        {activeModels.length === 0 && (
          <div className="text-center text-main-view-fg/50 py-4">
            {t('system-monitor:noRunningModels')}
          </div>
        )}
        {activeModels.length > 0 && (
          <div className="flex flex-col gap-4">
            {activeModels.map((model) => (
              <div className="bg-main-view-fg/3 rounded-lg p-4" key={model.id}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-main-view-fg">
                    {model.id}
                  </span>
                </div>
                <div className="flex flex-col gap-2 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-main-view-fg/70">
                      {t('system-monitor:provider')}
                    </span>
                    <span className="text-main-view-fg">llama.cpp</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-main-view-fg/70">
                      {t('system-monitor:uptime')}
                    </span>
                    <span className="text-main-view-fg">
                      {model.start_time && formatDuration(model.start_time)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-main-view-fg/70">
                      {t('system-monitor:actions')}
                    </span>
                    <span className="text-main-view-fg">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => stopRunningModel(model.id)}
                      >
                        {t('system-monitor:stop')}
                      </Button>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active GPUs Section */}
      <div className="mt-6 bg-main-view-fg/2 rounded-lg p-6 shadow-sm">
        <h2 className="text-base font-semibold text-main-view-fg mb-4">
          {t('system-monitor:activeGpus')}
        </h2>
        {hardwareData.gpus.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hardwareData.gpus
              .filter((gpu) => gpu.activated)
              .map((gpu, index) => (
                <div
                  key={gpu.id || index}
                  className="bg-main-view-fg/3 rounded-lg p-4"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-main-view-fg">
                      {gpu.name}
                    </span>
                    <div className="bg-green-500/20 px-2 py-1 rounded-sm">
                      {t('system-monitor:active')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 mt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-main-view-fg/70">
                        {t('system-monitor:vramUsage')}
                      </span>
                      <span className="text-main-view-fg">
                        {formatMegaBytes(gpu.total_vram - gpu.free_vram)} /{' '}
                        {formatMegaBytes(gpu.total_vram)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-main-view-fg/70">
                        {t('system-monitor:driverVersion')}
                      </span>
                      <span className="text-main-view-fg">
                        {gpu.additional_information.driver_version}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-main-view-fg/70">
                        {t('system-monitor:computeCapability')}
                      </span>
                      <span className="text-main-view-fg">
                        {gpu.additional_information.compute_cap}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Progress
                        value={
                          ((gpu.total_vram - gpu.free_vram) / gpu.total_vram) *
                          100
                        }
                        className="h-2 w-full"
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center text-main-view-fg/50 py-4">
            {t('system-monitor:noGpus')}
          </div>
        )}
        {hardwareData.gpus.length > 0 &&
          !hardwareData.gpus.some((gpu) => gpu.activated) && (
            <div className="text-center text-main-view-fg/50 py-4">
              {t('system-monitor:noActiveGpus')}
            </div>
          )}
      </div>
    </div>
  )
}
