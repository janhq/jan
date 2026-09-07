import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useHardware, type GPU } from '@/hooks/useHardware'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { useEffect, useState } from 'react'
import { IconDeviceDesktopAnalytics, IconRefresh } from '@tabler/icons-react'
import { useServiceHub } from '@/hooks/useServiceHub'
import type {
  DeviceList,
  HardwareData,
  SystemUsage,
} from '@/services/hardware/types'
import { cn, formatMegaBytes } from '@/lib/utils'
import { toNumber } from '@/utils/number'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { Button } from '@/components/ui/button'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.hardware as any)({
  component: HardwareContent,
})

const BACKEND_LABELS: Record<string, string> = {
  vulkan: 'Vulkan',
  cuda: 'CUDA',
  sycl: 'SYCL',
  hip: 'ROCm (HIP)',
  rocm: 'ROCm',
  opencl: 'OpenCL',
  metal: 'Metal',
  cpu: 'CPU',
}

function parseDeviceId(id: string): { backend: string; index: number } {
  const match = /^([A-Za-z]+?)(\d+)$/.exec(id ?? '')
  if (!match) return { backend: id ?? '', index: 0 }
  return { backend: match[1], index: Number(match[2]) }
}

function backendLabel(backend: string): string {
  return BACKEND_LABELS[backend.toLowerCase()] ?? backend.toUpperCase()
}

// Devices are joined to hardware-plugin GPUs by per-backend index, not by name:
// the same physical GPU appears at different indices under different backends.
function findGpuForDevice(
  backend: string,
  index: number,
  gpus: GPU[]
): GPU | undefined {
  const key = backend.toLowerCase()
  if (key === 'vulkan') {
    return gpus.find((gpu) => gpu.vulkan_info?.index === index)
  }
  if (key === 'cuda') {
    return gpus.find((gpu) => gpu.nvidia_info?.index === index)
  }
  return undefined
}

function BackendChip({ label, active }: { label: string; active: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      title={t('settings:hardware.backendApiDesc')}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-foreground"
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          active ? 'bg-primary' : 'bg-muted-foreground/50'
        )}
      />
      {label}
    </span>
  )
}

function SpecChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </span>
  )
}

function UsageMeter({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="flex items-center gap-3">
      <Progress value={clamped} className="h-1.5 w-32 border sm:w-40" />
      <span className="w-14 text-right font-mono text-xs tabular-nums text-foreground">
        {clamped.toFixed(1)}%
      </span>
    </div>
  )
}

type ActiveDevice = DeviceList & { activated: boolean }

interface GpuGroup {
  key: string
  name: string
  devices: ActiveDevice[]
}

const BACKEND_PRIORITY = [
  'cuda',
  'hip',
  'rocm',
  'sycl',
  'metal',
  'vulkan',
  'opencl',
]

function backendPriority(backend: string): number {
  const index = BACKEND_PRIORITY.indexOf(backend.toLowerCase())
  return index === -1 ? BACKEND_PRIORITY.length : index
}

// llama.cpp lists one device per backend, so a single physical GPU can appear
// as both CUDA0 and Vulkan0. Group by name and pair same-name devices by their
// per-backend enumeration order.
function groupDevices(devices: ActiveDevice[]): GpuGroup[] {
  const byName = new Map<string, Map<string, ActiveDevice[]>>()
  for (const device of devices) {
    const { backend } = parseDeviceId(device.id)
    const backends = byName.get(device.name) ?? new Map()
    byName.set(device.name, backends)
    backends.set(backend, [...(backends.get(backend) ?? []), device])
  }

  const groups: GpuGroup[] = []
  for (const [name, backends] of byName) {
    const lists = [...backends.values()]
    for (const list of lists) {
      list.sort((a, b) => parseDeviceId(a.id).index - parseDeviceId(b.id).index)
    }
    const unitCount = Math.max(...lists.map((list) => list.length))
    for (let i = 0; i < unitCount; i++) {
      const unit = lists
        .map((list) => list[i])
        .filter((device): device is ActiveDevice => Boolean(device))
        .sort(
          (a, b) =>
            backendPriority(parseDeviceId(a.id).backend) -
            backendPriority(parseDeviceId(b.id).backend)
        )
      if (unit.length > 0) {
        groups.push({
          key: unit.map((device) => device.id).join('+'),
          name,
          devices: unit,
        })
      }
    }
  }
  return groups
}

// Activated device if any (units are priority-sorted), else the preferred one.
function selectedDevice(group: GpuGroup): ActiveDevice {
  return group.devices.find((device) => device.activated) ?? group.devices[0]
}

function GpuGroupCard({
  group,
  gpus,
  onToggle,
  onSelect,
}: {
  group: GpuGroup
  gpus: GPU[]
  onToggle: () => void
  onSelect: (deviceId: string) => void
}) {
  const { t } = useTranslation()
  const activated = group.devices.some((device) => device.activated)
  const device = selectedDevice(group)
  const { backend, index } = parseDeviceId(device.id)
  const gpuInfo = findGpuForDevice(backend, index, gpus)
  const used = Math.max(0, device.mem - device.free)
  const usedPercent = device.mem > 0 ? (used / device.mem) * 100 : 0

  const facts: { label: string; value: string }[] = [
    ...(gpuInfo?.driver_version
      ? [
          {
            label: t('settings:hardware.driverVersion'),
            value: gpuInfo.driver_version,
          },
        ]
      : []),
    ...(gpuInfo?.vulkan_info?.api_version
      ? [
          {
            label: t('settings:hardware.apiVersion'),
            value: gpuInfo.vulkan_info.api_version,
          },
        ]
      : []),
    ...(gpuInfo?.nvidia_info?.compute_capability
      ? [
          {
            label: t('settings:hardware.computeCapability'),
            value: gpuInfo.nvidia_info.compute_capability,
          },
        ]
      : []),
  ]

  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 p-4 transition-colors',
        activated ? 'border-l-2 border-l-primary' : 'bg-muted/20'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate font-medium text-foreground">{group.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {group.devices.length > 1 ? (
              group.devices.map((groupDevice) => {
                const isSelected = groupDevice.id === device.id
                return (
                  <button
                    key={groupDevice.id}
                    type="button"
                    onClick={() => onSelect(groupDevice.id)}
                    title={t('settings:hardware.backendSelectDesc')}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs uppercase tracking-wider transition-colors',
                      isSelected
                        ? 'border-primary/60 text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        isSelected && activated
                          ? 'bg-primary'
                          : 'bg-muted-foreground/50'
                      )}
                    />
                    {backendLabel(parseDeviceId(groupDevice.id).backend)}
                  </button>
                )
              })
            ) : (
              <BackendChip label={backendLabel(backend)} active={activated} />
            )}
            {!activated && (
              <span className="text-xs text-muted-foreground">
                {t('settings:hardware.gpuDisabled')}
              </span>
            )}
          </div>
        </div>
        <Switch checked={activated} onCheckedChange={onToggle} />
      </div>

      <div className={cn('mt-4', !activated && 'opacity-60')}>
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            {t('settings:hardware.vram')}
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatMegaBytes(device.free)} {t('settings:hardware.freeOf')}{' '}
            {formatMegaBytes(device.mem)}
          </span>
        </div>
        <Progress value={usedPercent} className="mt-1.5 h-1.5 w-full border" />
        {facts.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            {facts.map((fact) => (
              <div key={fact.label} className="flex items-baseline gap-1.5">
                <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                <dd className="font-mono text-xs tabular-nums text-foreground">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}

// Apple Silicon: the hardware plugin enumerates GPUs via Vulkan/NVML only and
// llamacpp device listing is skipped on macOS, so the Metal GPU is synthesized
// from CPU + unified memory info.
function AppleSiliconGpuCard({
  name,
  totalMemory,
  usedMemory,
}: {
  name: string
  totalMemory: number
  usedMemory: number
}) {
  const { t } = useTranslation()
  const usedPercent = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0

  return (
    <div className="rounded-lg border border-border/60 border-l-2 border-l-primary p-4">
      <div className="min-w-0">
        <h2 className="truncate font-medium text-foreground">{name}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <BackendChip label="Metal" active />
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-muted-foreground">
            {t('settings:hardware.unifiedMemory')}
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatMegaBytes(Math.max(0, totalMemory - usedMemory))}{' '}
            {t('settings:hardware.freeOf')} {formatMegaBytes(totalMemory)}
          </span>
        </div>
        <Progress value={usedPercent} className="mt-1.5 h-1.5 w-full border" />
        <p className="mt-3 text-xs text-muted-foreground">
          {t('settings:hardware.unifiedMemoryDesc')}
        </p>
      </div>
    </div>
  )
}

function HardwareContent() {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const serviceHub = useServiceHub()
  const {
    hardwareData,
    systemUsage,
    setHardwareData,
    updateSystemUsage,
    pollingPaused,
  } = useHardware()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  const { providers } = useModelProvider()
  const llamacpp = providers.find((p) => p.provider === 'llamacpp')

  const llamacppDevicesResult = useLlamacppDevices()

  // Use default values on macOS since llamacpp devices are not relevant
  const {
    devices: llamacppDevices,
    loading: llamacppDevicesLoading,
    error: llamacppDevicesError,
    setActivations,
    fetchDevices,
  } = IS_MACOS
    ? {
        devices: [],
        loading: false,
        error: null,
        setActivations: async () => {},
        fetchDevices: () => {},
      }
    : llamacppDevicesResult

  useEffect(() => {
    fetchDevices()
  }, [fetchDevices])

  useEffect(() => {
    setIsLoading(true)
    Promise.all([
      serviceHub
        .hardware()
        .getHardwareInfo()
        .then((data: HardwareData | null) => {
          if (data) setHardwareData(data)
        })
        .catch((error) => {
          console.error('Failed to get hardware info:', error)
        }),
      serviceHub
        .hardware()
        .getSystemUsage()
        .then((data: SystemUsage | null) => {
          if (data) updateSystemUsage(data)
        })
        .catch((error: unknown) => {
          console.error('Failed to get initial system usage:', error)
        }),
    ]).finally(() => {
      setIsLoading(false)
    })
  }, [serviceHub, setHardwareData, updateSystemUsage])

  useEffect(() => {
    if (pollingPaused) {
      return
    }
    const intervalId = setInterval(() => {
      serviceHub
        .hardware()
        .getSystemUsage()
        .then((data: SystemUsage | null) => {
          if (data) updateSystemUsage(data)
        })
        .catch((error: unknown) => {
          console.error('Failed to get system usage:', error)
        })
    }, 5000)

    return () => clearInterval(intervalId)
  }, [serviceHub, updateSystemUsage, pollingPaused])

  const handleClickSystemMonitor = async () => {
    try {
      await serviceHub.window().openSystemMonitorWindow()
    } catch (error) {
      console.error('Failed to open system monitor window:', error)
    }
  }

  const handleRefreshHardware = async () => {
    try {
      setIsLoading(true)
      await serviceHub.hardware().refreshHardwareInfo()
      const [hardwareData, systemUsage] = await Promise.all([
        serviceHub.hardware().getHardwareInfo(),
        serviceHub.hardware().getSystemUsage(),
      ])
      if (hardwareData) setHardwareData(hardwareData)
      if (systemUsage) updateSystemUsage(systemUsage)
      if (!IS_MACOS) fetchDevices()
    } catch (error) {
      console.error('Failed to refresh hardware:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const applyActivations = (updates: Record<string, boolean>) => {
    setActivations(updates)
    serviceHub.models().stopAllModels()
    serviceHub
      .models()
      .getActiveModels()
      .then((models) => setActiveModels(models || []))
  }

  const handleToggleGroup = (group: GpuGroup) => {
    const activated = group.devices.some((device) => device.activated)
    const updates: Record<string, boolean> = {}
    for (const device of group.devices) updates[device.id] = false
    if (!activated) updates[selectedDevice(group).id] = true
    applyActivations(updates)
  }

  const handleSelectBackend = (group: GpuGroup, deviceId: string) => {
    const updates: Record<string, boolean> = {}
    for (const device of group.devices) {
      updates[device.id] = device.id === deviceId
    }
    applyActivations(updates)
  }

  const gpus = hardwareData.gpus ?? []
  const isAppleSilicon =
    IS_MACOS && /^(arm64|aarch64)$/i.test(hardwareData.cpu?.arch ?? '')
  const memoryPercent =
    hardwareData.total_memory > 0
      ? toNumber(systemUsage.used_memory / hardwareData.total_memory) * 100
      : 0
  const cpuExtensions = hardwareData.cpu?.extensions ?? []

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div
          className={cn(
            'flex items-center justify-between w-full mr-2 pr-3',
            !IS_MACOS && 'pr-30'
          )}
        >
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 relative z-50"
            onClick={handleClickSystemMonitor}
          >
            <IconDeviceDesktopAnalytics className="text-muted-foreground size-5" />
            <p>{t('settings:hardware.systemMonitor')}</p>
          </Button>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-muted-foreground">
                Loading hardware information...
              </div>
            </div>
          ) : (
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              <Card title={t('settings:hardware.os')}>
                <CardItem
                  title={t('settings:hardware.name')}
                  actions={
                    <span className="text-foreground capitalize">
                      {hardwareData.os_type}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.version')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.os_name}
                    </span>
                  }
                />
              </Card>

              <Card title={t('settings:hardware.cpu')}>
                <CardItem
                  title={t('settings:hardware.model')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.cpu?.name}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.architecture')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.cpu?.arch}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.cores')}
                  actions={
                    <span className="text-foreground tabular-nums">
                      {hardwareData.cpu?.core_count}
                    </span>
                  }
                />
                {cpuExtensions.length > 0 && (
                  <CardItem
                    title={t('settings:hardware.instructions')}
                    column={cpuExtensions.length > 6}
                    actions={
                      <div className="flex flex-wrap gap-1 pt-1">
                        {cpuExtensions.map((extension) => (
                          <SpecChip key={extension}>{extension}</SpecChip>
                        ))}
                      </div>
                    }
                  />
                )}
                <CardItem
                  title={t('settings:hardware.usage')}
                  actions={
                    systemUsage.cpu > 0 && (
                      <UsageMeter percent={systemUsage.cpu} />
                    )
                  }
                />
              </Card>

              <Card
                title={t(
                  isAppleSilicon
                    ? 'settings:hardware.unifiedMemory'
                    : 'settings:hardware.memory'
                )}
              >
                <CardItem
                  title={t('settings:hardware.totalRam')}
                  actions={
                    <span className="text-foreground tabular-nums">
                      {formatMegaBytes(hardwareData.total_memory)}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.availableRam')}
                  actions={
                    <span className="text-foreground tabular-nums">
                      {formatMegaBytes(
                        hardwareData.total_memory - systemUsage.used_memory
                      )}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.usage')}
                  actions={
                    hardwareData.total_memory > 0 && (
                      <UsageMeter percent={memoryPercent} />
                    )
                  }
                />
              </Card>

              {isAppleSilicon && (
                <Card title={t('settings:hardware.gpus')}>
                  <AppleSiliconGpuCard
                    name={hardwareData.cpu?.name || 'Apple Silicon'}
                    totalMemory={hardwareData.total_memory}
                    usedMemory={systemUsage.used_memory}
                  />
                </Card>
              )}

              {!IS_MACOS && llamacpp && (
                <Card
                  title={t('settings:hardware.gpus')}
                  header={
                    <div className="flex items-center justify-end -mt-10 mb-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRefreshHardware}
                        disabled={isLoading}
                        className="flex items-center gap-1.5"
                      >
                        <IconRefresh className="size-4 text-muted-foreground" />
                        {t('settings:hardware.refresh')}
                      </Button>
                    </div>
                  }
                >
                  {llamacppDevicesLoading ? (
                    <div className="text-muted-foreground text-sm">
                      {t('settings:hardware.detectingDevices')}
                    </div>
                  ) : llamacppDevicesError ? (
                    <div className="text-sm">
                      <span className="text-destructive">
                        {t('settings:hardware.deviceListError')}
                      </span>
                      <p className="mt-1 text-muted-foreground">
                        {llamacppDevicesError}
                      </p>
                    </div>
                  ) : llamacppDevices.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {groupDevices(llamacppDevices).map((group) => (
                        <GpuGroupCard
                          key={group.key}
                          group={group}
                          gpus={gpus}
                          onToggle={() => handleToggleGroup(group)}
                          onSelect={(deviceId) =>
                            handleSelectBackend(group, deviceId)
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm">
                      <span className="text-foreground">
                        {t('settings:hardware.noGpus')}
                      </span>
                      <p className="mt-1 text-muted-foreground">
                        {t('settings:hardware.noDevicesDesc')}
                      </p>
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
