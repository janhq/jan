import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useHardware } from '@/hooks/useHardware'
// import { useVulkan } from '@/hooks/useVulkan'
import type { GPU, HardwareData } from '@/hooks/useHardware'
import { useEffect, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  IconGripVertical,
  IconDeviceDesktopAnalytics,
} from '@tabler/icons-react'
import { getHardwareInfo, getSystemUsage } from '@/services/hardware'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { formatMegaBytes } from '@/lib/utils'
import { windowKey } from '@/constants/windows'
import { toNumber } from '@/utils/number'
import { useModelProvider } from '@/hooks/useModelProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.hardware as any)({
  component: Hardware,
})

function SortableGPUItem({ gpu, index, isCompatible, isActivated }: { gpu: GPU; index: number; isCompatible: boolean; isActivated: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index })
  const { t } = useTranslation()

  const { systemUsage, toggleGPUActivation, gpuLoading } = useHardware()
  const usage = systemUsage.gpus[index]

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <div ref={setNodeRef} style={style} className={`mb-4 last:mb-0 ${!isCompatible ? 'opacity-60' : ''}`}>
      <CardItem
        title={
          <div className="flex items-center gap-2">
            <div
              {...attributes}
              {...listeners}
              className="size-6 cursor-move flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
            >
              <IconGripVertical size={18} className="text-main-view-fg/60" />
            </div>
            <span className="text-main-view-fg/80">{gpu.name}</span>
            {!isCompatible && (
              <span className="text-xs bg-destructive/10 text-destructive px-2 py-1 rounded-sm">
                Incompatible with current backend
              </span>
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-4">
            <Switch
              checked={isActivated}
              disabled={!!gpuLoading[index] || !isCompatible}
              onCheckedChange={() => toggleGPUActivation(index)}
            />
          </div>
        }
      />
      <div className="ml-8 mt-3">
        <CardItem
          title={t('settings:hardware.vram')}
          actions={
            <span className="text-main-view-fg/80">
              {formatMegaBytes(usage?.used_memory)}{' '}
              {t('settings:hardware.freeOf')}{' '}
              {formatMegaBytes(gpu.total_memory)}
            </span>
          }
        />
        <CardItem
          title={t('settings:hardware.driverVersion')}
          actions={
            <span className="text-main-view-fg/80">
              {gpu.driver_version?.slice(0, 50) || '-'}
            </span>
          }
        />
        <CardItem
          title={t('settings:hardware.computeCapability')}
          actions={
            <span className="text-main-view-fg/80">
              {gpu.nvidia_info?.compute_capability ??
                gpu.vulkan_info?.api_version}
            </span>
          }
        />
      </div>
    </div>
  )
}

function Hardware() {
  const { t } = useTranslation()
  const {
    hardwareData,
    systemUsage,
    setHardwareData,
    updateHardwareDataPreservingGpuOrder,
    updateSystemUsage,
    reorderGPUs,
    pollingPaused,
  } = useHardware()
  // const { vulkanEnabled, setVulkanEnabled } = useVulkan()

  const { providers } = useModelProvider()
  const llamacpp = providers.find((p) => p.provider === 'llamacpp')
  const versionBackend = llamacpp?.settings.find((s) => s.key === "version_backend")?.controller_props.value

  // Determine backend type and filter GPUs accordingly
  const isCudaBackend = typeof versionBackend === 'string' && versionBackend.includes('cuda')
  const isVulkanBackend = typeof versionBackend === 'string' && versionBackend.includes('vulkan')

  // Filter and prepare GPUs based on backend
  const getFilteredGPUs = () => {
    // Always show all GPUs, but compatibility will be determined by isGPUActive
    return hardwareData.gpus
  }

  const filteredGPUs = getFilteredGPUs()

  // Check if GPU should be active based on backend compatibility
  const isGPUCompatible = (gpu: GPU) => {
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
  const isGPUActive = (gpu: GPU) => {
    return isGPUCompatible(gpu) && (gpu.activated ?? false)
  }

  useEffect(() => {
    getHardwareInfo().then((freshData) => {
      const data = freshData as unknown as HardwareData
      updateHardwareDataPreservingGpuOrder(data)
    })
  }, [updateHardwareDataPreservingGpuOrder])

  // Hardware and provider sync logic
  const { getActivatedDeviceString, updateGPUActivationFromDeviceString } = useHardware()
  const { updateProvider, getProviderByName } = useModelProvider()
  const [isInitialized, setIsInitialized] = useState(false)

  // Initialize GPU activations from device setting on first load
  useEffect(() => {
    if (hardwareData.gpus.length > 0 && !isInitialized) {
      const llamacppProvider = getProviderByName('llamacpp')
      const currentDeviceSetting = llamacppProvider?.settings.find(s => s.key === 'device')?.controller_props.value as string
      
      if (currentDeviceSetting) {
        console.log(`Initializing GPU activations from device setting: "${currentDeviceSetting}"`)
        updateGPUActivationFromDeviceString(currentDeviceSetting)
      }
      
      setIsInitialized(true)
    }
  }, [hardwareData.gpus.length, isInitialized, getProviderByName, updateGPUActivationFromDeviceString])

  // Sync device setting when GPU activations change (only after initialization)
  const gpuActivationStates = hardwareData.gpus.map(gpu => gpu.activated)
  
  useEffect(() => {
    if (isInitialized && hardwareData.gpus.length > 0) {
      const llamacppProvider = getProviderByName('llamacpp')
      const backendType = llamacppProvider?.settings.find(s => s.key === 'version_backend')?.controller_props.value as string
      const deviceString = getActivatedDeviceString(backendType)
      
      if (llamacppProvider) {
        const currentDeviceSetting = llamacppProvider.settings.find(s => s.key === 'device')
        
        // Sync device string when GPU activations change (only after initialization)
        if (currentDeviceSetting && currentDeviceSetting.controller_props.value !== deviceString) {
          console.log(`Syncing device string from "${currentDeviceSetting.controller_props.value}" to "${deviceString}"`)
          
          const updatedSettings = llamacppProvider.settings.map(setting => {
            if (setting.key === 'device') {
              return {
                ...setting,
                controller_props: {
                  ...setting.controller_props,
                  value: deviceString
                }
              }
            }
            return setting
          })
          
          updateProvider('llamacpp', {
            settings: updatedSettings
          })
        }
      }
    }
  }, [isInitialized, gpuActivationStates, versionBackend, getActivatedDeviceString, updateProvider, getProviderByName, hardwareData.gpus.length])

  // Set up DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  )

  // Handle drag end event
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      // Find the actual indices in the original hardwareData.gpus array
      const activeGpu = filteredGPUs[active.id as number]
      const overGpu = filteredGPUs[over.id as number]
      
      const oldIndex = hardwareData.gpus.findIndex(gpu => gpu.uuid === activeGpu.uuid)
      const newIndex = hardwareData.gpus.findIndex(gpu => gpu.uuid === overGpu.uuid)

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderGPUs(oldIndex, newIndex)
      }
    }
  }

  useEffect(() => {
    if (pollingPaused) return
    const intervalId = setInterval(() => {
      getSystemUsage().then((data) => {
        updateSystemUsage(data)
      })
    }, 5000)

    return () => clearInterval(intervalId)
  }, [setHardwareData, updateSystemUsage, pollingPaused])

  const handleClickSystemMonitor = async () => {
    try {
      // Check if system monitor window already exists
      const existingWindow = await WebviewWindow.getByLabel(
        windowKey.systemMonitorWindow
      )

      if (existingWindow) {
        // If window exists, focus it
        await existingWindow.setFocus()
        console.log('Focused existing system monitor window')
      } else {
        // Create a new system monitor window
        const monitorWindow = new WebviewWindow(windowKey.systemMonitorWindow, {
          url: route.systemMonitor,
          title: 'System Monitor - Jan',
          width: 900,
          height: 600,
          resizable: true,
          center: true,
        })

        // Listen for window creation
        monitorWindow.once('tauri://created', () => {
          console.log('System monitor window created')
        })

        // Listen for window errors
        monitorWindow.once('tauri://error', (e) => {
          console.error('Error creating system monitor window:', e)
        })
      }
    } catch (error) {
      console.error('Failed to open system monitor window:', error)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <div className="flex items-center gap-2 justify-between w-full pr-3">
          <h1 className="font-medium">{t('common:settings')}</h1>
          <div
            className="flex items-center gap-1 hover:bg-main-view-fg/8 px-1.5 py-0.5 rounded relative z-10 cursor-pointer"
            onClick={handleClickSystemMonitor}
          >
            <IconDeviceDesktopAnalytics className="text-main-view-fg/50 size-5" />
            <p>{t('settings:hardware.systemMonitor')}</p>
          </div>
        </div>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* OS Information */}
            <Card title={t('settings:hardware.os')}>
              <CardItem
                title={t('settings:hardware.name')}
                actions={
                  <span className="text-main-view-fg/80 capitalize">
                    {hardwareData.os_type}
                  </span>
                }
              />
              <CardItem
                title={t('settings:hardware.version')}
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.os_name}
                  </span>
                }
              />
            </Card>

            {/* CPU Information */}
            <Card title={t('settings:hardware.cpu')}>
              <CardItem
                title={t('settings:hardware.model')}
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu?.name}
                  </span>
                }
              />
              <CardItem
                title={t('settings:hardware.architecture')}
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu?.arch}
                  </span>
                }
              />
              <CardItem
                title={t('settings:hardware.cores')}
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu?.core_count}
                  </span>
                }
              />
              {hardwareData.cpu?.extensions?.join(', ').length > 0 && (
                <CardItem
                  title={t('settings:hardware.instructions')}
                  column={hardwareData.cpu?.extensions.length > 6}
                  actions={
                    <span className="text-main-view-fg/80 break-words">
                      {hardwareData.cpu?.extensions?.join(', ')}
                    </span>
                  }
                />
              )}
              <CardItem
                title={t('settings:hardware.usage')}
                actions={
                  <div className="flex items-center gap-2">
                    {systemUsage.cpu > 0 && (
                      <>
                        <Progress
                          value={systemUsage.cpu}
                          className="h-2 w-10"
                        />
                        <span className="text-main-view-fg/80">
                          {systemUsage.cpu?.toFixed(2)}%
                        </span>
                      </>
                    )}
                  </div>
                }
              />
            </Card>

            {/* RAM Information */}
            <Card title={t('settings:hardware.memory')}>
              <CardItem
                title={t('settings:hardware.totalRam')}
                actions={
                  <span className="text-main-view-fg/80">
                    {formatMegaBytes(hardwareData.total_memory)}
                  </span>
                }
              />
              <CardItem
                title={t('settings:hardware.availableRam')}
                actions={
                  <span className="text-main-view-fg/80">
                    {formatMegaBytes(
                      hardwareData.total_memory - systemUsage.used_memory
                    )}
                  </span>
                }
              />
              <CardItem
                title={t('settings:hardware.usage')}
                actions={
                  <div className="flex items-center gap-2">
                    {hardwareData.total_memory > 0 && (
                      <>
                        <Progress
                          value={
                            toNumber(
                              systemUsage.used_memory / systemUsage.total_memory
                            ) * 100
                          }
                          className="h-2 w-10"
                        />
                        <span className="text-main-view-fg/80">
                          {(
                            toNumber(
                              systemUsage.used_memory / systemUsage.total_memory
                            ) * 100
                          ).toFixed(2)}
                          %
                        </span>
                      </>
                    )}
                  </div>
                }
              />
            </Card>

            {/* Vulkan Settings */}
            {/* {hardwareData.gpus.length > 0 && (
              <Card title={t('settings:hardware.vulkan')}>
                <CardItem
                  title={t('settings:hardware.enableVulkan')}
                  description={t('settings:hardware.enableVulkanDesc')}
                  actions={
                    <div className="flex items-center gap-4">
                      <Switch
                        checked={vulkanEnabled}
                        onCheckedChange={(checked) => {
                          setVulkanEnabled(checked)
                          setTimeout(() => {
                            window.location.reload()
                          }, 500) // Reload after 500ms to apply changes
                        }}
                      />
                    </div>
                  }
                />
              </Card>
            )} */}

            {/* GPU Information */}
            {!IS_MACOS ? (
              <Card title={t('settings:hardware.gpus')}>
             
                
                {hardwareData.gpus.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={filteredGPUs.map((_, index) => index)}
                      strategy={verticalListSortingStrategy}
                    >
                      {filteredGPUs.map((gpu, index) => (
                        <SortableGPUItem 
                          key={index} 
                          gpu={gpu} 
                          index={index} 
                          isCompatible={isGPUCompatible(gpu)} 
                          isActivated={isGPUActive(gpu)} 
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  <CardItem
                    title={t('settings:hardware.noGpus')}
                    actions={<></>}
                  />
                )}
              </Card>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
