/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useHardware } from '@/hooks/useHardware'
import { getHardwareInfo, getSystemUsage } from '@/services/hardware'
import { Progress } from '@/components/ui/progress'
import type { HardwareData } from '@/hooks/useHardware'
import { route } from '@/constants/routes'
import { formatMegaBytes } from '@/lib/utils'
import { IconDeviceDesktopAnalytics } from '@tabler/icons-react'
import { getActiveModels, stopModel } from '@/services/models'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toNumber } from '@/utils/number'
import { useModelProvider } from '@/hooks/useModelProvider'

export const Route = createFileRoute(route.systemMonitor as any)({
  component: SystemMonitor,
})

function SystemMonitor() {
  const { t } = useTranslation()
  const {
    hardwareData,
    systemUsage,
    updateHardwareDataPreservingGpuOrder,
    updateSystemUsage,
    updateGPUActivationFromDeviceString,
  } = useHardware()
  const [activeModels, setActiveModels] = useState<string[]>([])
  const { providers, getProviderByName } = useModelProvider()
  const [isInitialized, setIsInitialized] = useState(false)

  // Determine backend type and filter GPUs accordingly (same logic as hardware.tsx)
  const llamacpp = providers.find((p) => p.provider === 'llamacpp')
  const versionBackend = llamacpp?.settings.find(
    (s) => s.key === 'version_backend'
  )?.controller_props.value

  useEffect(() => {
    // Initial data fetch - use updateHardwareDataPreservingGpuOrder like hardware.tsx
    getHardwareInfo().then((data) => {
      updateHardwareDataPreservingGpuOrder(data as unknown as HardwareData)
    })
    getActiveModels().then(setActiveModels)

    // Set up interval for real-time updates
    const intervalId = setInterval(() => {
      getSystemUsage().then((data) => {
        updateSystemUsage(data)
      })
      getActiveModels().then(setActiveModels)
    }, 5000)

    return () => clearInterval(intervalId)
  }, [updateHardwareDataPreservingGpuOrder, setActiveModels, updateSystemUsage])

  // Initialize GPU activations from device setting on first load (same logic as hardware.tsx)
  useEffect(() => {
    if (hardwareData.gpus.length > 0 && !isInitialized) {
      const llamacppProvider = getProviderByName('llamacpp')
      const currentDeviceSetting = llamacppProvider?.settings.find(
        (s) => s.key === 'device'
      )?.controller_props.value as string

      if (currentDeviceSetting) {
        updateGPUActivationFromDeviceString(currentDeviceSetting)
      }

      setIsInitialized(true)
    }
  }, [
    hardwareData.gpus.length,
    isInitialized,
    getProviderByName,
    updateGPUActivationFromDeviceString,
  ])

  // Sync device setting when GPU activations change (only after initialization) - same logic as hardware.tsx
  const { getActivatedDeviceString } = useHardware()
  const { updateProvider } = useModelProvider()
  const gpuActivationStates = hardwareData.gpus.map((gpu) => gpu.activated)

  useEffect(() => {
    if (isInitialized && hardwareData.gpus.length > 0) {
      const llamacppProvider = getProviderByName('llamacpp')
      const backendType = llamacppProvider?.settings.find(
        (s) => s.key === 'version_backend'
      )?.controller_props.value as string
      const deviceString = getActivatedDeviceString(backendType)

      if (llamacppProvider) {
        const currentDeviceSetting = llamacppProvider.settings.find(
          (s) => s.key === 'device'
        )

        // Sync device string when GPU activations change (only after initialization)
        if (
          currentDeviceSetting &&
          currentDeviceSetting.controller_props.value !== deviceString
        ) {
          const updatedSettings = llamacppProvider.settings.map((setting) => {
            if (setting.key === 'device') {
              return {
                ...setting,
                controller_props: {
                  ...setting.controller_props,
                  value: deviceString,
                },
              }
            }
            return setting
          })

          updateProvider('llamacpp', {
            settings: updatedSettings,
          })
        }
      }
    }
  }, [
    isInitialized,
    gpuActivationStates,
    versionBackend,
    getActivatedDeviceString,
    updateProvider,
    getProviderByName,
    hardwareData.gpus.length,
  ])

  const stopRunningModel = (modelId: string) => {
    stopModel(modelId)
      .then(() => {
        setActiveModels((prevModels) =>
          prevModels.filter((model) => model !== modelId)
        )
      })
      .catch((error) => {
        console.error('Error stopping model:', error)
      })
  }

  // Calculate RAM usage percentage
  const ramUsagePercentage =
    toNumber(
      (hardwareData.total_memory - systemUsage.used_memory) /
        hardwareData.total_memory
    ) * 100

  // Determine backend type and filter GPUs accordingly
  const isCudaBackend =
    typeof versionBackend === 'string' && versionBackend.includes('cuda')
  const isVulkanBackend =
    typeof versionBackend === 'string' && versionBackend.includes('vulkan')

  // Check if GPU should be active based on backend compatibility
  const isGPUCompatible = (gpu: any) => {
    if (isCudaBackend) {
      return gpu.nvidia_info !== null
    } else if (isVulkanBackend) {
      return gpu.vulkan_info !== null
    } else {
      // No valid backend - all GPUs are inactive
      return false
    }
  }

  // Check if GPU is actually activated
  const isGPUActive = (gpu: any) => {
    const compatible = isGPUCompatible(gpu)
    const activated = gpu.activated ?? false
    const result = compatible && activated
    return result
  }

  // Filter to show only active GPUs
  const activeGPUs = hardwareData.gpus.filter((gpu) => isGPUActive(gpu))

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
              <span className="text-main-view-fg">{hardwareData.cpu.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:cores')}
              </span>
              <span className="text-main-view-fg">
                {hardwareData.cpu.core_count}
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
                  {systemUsage.cpu.toFixed(2)}%
                </span>
              </div>
              <Progress value={systemUsage.cpu} className="h-3 w-full" />
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
                {formatMegaBytes(hardwareData.total_memory)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:availableRam')}
              </span>
              <span className="text-main-view-fg">
                {formatMegaBytes(
                  hardwareData.total_memory - systemUsage.used_memory
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-main-view-fg/70">
                {t('system-monitor:usedRam')}
              </span>
              <span className="text-main-view-fg">
                {formatMegaBytes(
                  hardwareData.total_memory - systemUsage.used_memory
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
              <div className="bg-main-view-fg/3 rounded-lg p-4" key={model}>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-main-view-fg">
                    {model}
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
                    {/* <span className="text-main-view-fg">
                      {model.start_time && formatDuration(model.start_time)}
                    </span> */}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-main-view-fg/70">
                      {t('system-monitor:actions')}
                    </span>
                    <span className="text-main-view-fg">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => stopRunningModel(model)}
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
        {!isInitialized ? (
          <div className="text-center text-main-view-fg/50 py-4">
            Initializing GPU states...
          </div>
        ) : activeGPUs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeGPUs.map((gpu, index) => {
              // Find the corresponding system usage data for this GPU
              const gpuUsage = systemUsage.gpus.find(
                (usage) => usage.uuid === gpu.uuid
              )

              return (
                <div
                  key={gpu.uuid || index}
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
                        {gpuUsage ? (
                          <>
                            {formatMegaBytes(gpuUsage.used_memory)} /{' '}
                            {formatMegaBytes(gpu.total_memory)}
                          </>
                        ) : (
                          <>
                            {formatMegaBytes(0)} /{' '}
                            {formatMegaBytes(gpu.total_memory)}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-main-view-fg/70">
                        {t('system-monitor:driverVersion')}
                      </span>
                      <span className="text-main-view-fg">
                        {gpu.driver_version || '-'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-main-view-fg/70">
                        {t('system-monitor:computeCapability')}
                      </span>
                      <span className="text-main-view-fg">
                        {gpu.nvidia_info?.compute_capability ||
                          gpu.vulkan_info?.api_version ||
                          '-'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Progress
                        value={
                          gpuUsage
                            ? (gpuUsage.used_memory / gpu.total_memory) * 100
                            : 0
                        }
                        className="h-2 w-full"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center text-main-view-fg/50 py-4">
            {t('system-monitor:noGpus')}
          </div>
        )}
      </div>
    </div>
  )
}
