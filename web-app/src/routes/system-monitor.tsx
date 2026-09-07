/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useHardware, type GPU } from '@/hooks/useHardware'
import { Progress } from '@/components/ui/progress'
import { route } from '@/constants/routes'
import { formatMegaBytes } from '@/lib/utils'
import { IconDeviceDesktopAnalytics } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toNumber } from '@/utils/number'
import { useServiceHub } from '@/hooks/useServiceHub'

export const Route = createFileRoute(route.systemMonitor as any)({
  component: SystemMonitorContent,
})

function gpuBackendLabel(gpu: GPU): string {
  if (gpu.nvidia_info?.compute_capability) return 'CUDA'
  if (gpu.vulkan_info?.api_version) return 'Vulkan'
  return gpu.vendor || 'GPU'
}

function SystemMonitorContent() {
  const { t } = useTranslation()
  const { hardwareData, systemUsage, updateSystemUsage } = useHardware()
  const serviceHub = useServiceHub()

  // Extensions never load in this secondary window, so GPU data comes from
  // the hardware plugin (allowed by this window's capabilities), not llamacpp.
  const gpus = hardwareData.gpus ?? []

  // Poll system usage every 5 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      serviceHub.hardware().getSystemUsage()
        .then((data) => {
          if (data) {
            updateSystemUsage(data)
          }
        })
        .catch((error) => {
          console.error('Failed to get system usage:', error)
        })
    }, 5000)

    return () => clearInterval(intervalId)
  }, [updateSystemUsage, serviceHub])

  // Calculate RAM usage percentage
  const ramUsagePercentage =
    toNumber(systemUsage.used_memory / hardwareData.total_memory) * 100

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto p-6">
      <div className="flex items-center mb-4 gap-2">
        <IconDeviceDesktopAnalytics className="text-muted-foreground/80 size-6" />
        <h1 className="text-xl font-bold text-muted-foreground">
          {t('system-monitor:title')}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* CPU Usage Card */}
        <div className="bg-secondary/50 rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-4">
            {t('system-monitor:cpuUsage')}
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {t('system-monitor:model')}
              </span>
              <span className="text-foreground">{hardwareData.cpu.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {t('system-monitor:cores')}
              </span>
              <span className="text-foreground">
                {hardwareData.cpu.core_count}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {t('system-monitor:architecture')}
              </span>
              <span className="text-foreground">{hardwareData.cpu.arch}</span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">
                  {t('system-monitor:currentUsage')}
                </span>
                <span className="text-foreground font-bold">
                  {systemUsage.cpu.toFixed(2)}%
                </span>
              </div>
              <Progress value={systemUsage.cpu} className="h-3 w-full" />
            </div>
          </div>
        </div>

        {/* RAM Usage Card */}
        <div className="bg-secondary/50 rounded-lg p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-4">
            {t('system-monitor:memoryUsage')}
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {t('system-monitor:totalRam')}
              </span>
              <span className="text-foreground">
                {formatMegaBytes(hardwareData.total_memory)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {t('system-monitor:availableRam')}
              </span>
              <span className="text-foreground">
                {formatMegaBytes(
                  hardwareData.total_memory - systemUsage.used_memory
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">
                {t('system-monitor:usedRam')}
              </span>
              <span className="text-foreground">
                {formatMegaBytes(systemUsage.used_memory)}
              </span>
            </div>
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-muted-foreground">
                  {t('system-monitor:currentUsage')}
                </span>
                <span className="text-foreground font-bold">
                  {ramUsagePercentage.toFixed(2)}%
                </span>
              </div>
              <Progress value={ramUsagePercentage} className="h-3 w-full" />
            </div>
          </div>
        </div>

        {/* GPU Usage Card */}
        {!IS_MACOS && (
          <div className="bg-secondary/50 rounded-lg p-6 shadow-sm">
            <h2 className="text-base font-semibold mb-4">
              {t('system-monitor:gpus')}
            </h2>
            <div className="flex flex-col gap-4">
              {gpus.length > 0 ? (
                gpus.map((gpu) => {
                  const usage = systemUsage.gpus?.find(
                    (u) => u.uuid === gpu.uuid
                  )
                  const total = usage?.total_memory || gpu.total_memory
                  const used = usage?.used_memory ?? 0
                  const usagePercent =
                    total > 0 ? toNumber(used / total) * 100 : 0
                  return (
                    <div key={gpu.uuid} className="flex flex-col gap-2">
                      <div className="flex justify-between items-center gap-2">
                        <span
                          className="text-foreground truncate"
                          title={gpu.name}
                        >
                          {gpu.name}
                        </span>
                        <span className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-foreground">
                          {gpuBackendLabel(gpu)}
                        </span>
                      </div>
                      {gpu.driver_version && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">
                            {t('system-monitor:driverVersion')}
                          </span>
                          <span className="text-foreground">
                            {gpu.driver_version}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">
                          {t('system-monitor:vram')}
                        </span>
                        <span className="text-foreground">
                          {formatMegaBytes(total)}
                        </span>
                      </div>
                      {usage && (
                        <div className="mt-1">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-muted-foreground">
                              {t('system-monitor:vramUsage')}
                            </span>
                            <span className="text-foreground font-bold">
                              {usagePercent.toFixed(2)}%
                            </span>
                          </div>
                          <Progress
                            value={usagePercent}
                            className="h-3 w-full"
                          />
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="text-muted-foreground text-center py-4">
                  {t('system-monitor:noGpus')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
