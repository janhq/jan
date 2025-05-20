import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from 'react-i18next'
import { useHardware } from '@/hooks/useHardware'
import type { GPU } from '@/hooks/useHardware'
import { useEffect } from 'react'
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
import { IconGripVertical } from '@tabler/icons-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.hardware as any)({
  component: Hardware,
})

const fetchHardwareData = () => {
  return {
    cpu: {
      arch: 'x86_64',
      cores: 8,
      instructions: ['SSE4.1', 'SSE4.2', 'AVX2'],
      model: 'Apple M4 chip (10-core CPU, 10-core GPU)',
      usage: Math.random() * 100, // Simulate changing CPU usage
    },
    gpus: [
      {
        activated: true,
        additional_information: {
          compute_cap: '7.5',
          driver_version: '535.129.03',
        },
        free_vram: Math.floor(Math.random() * 4 * 1024 * 1024 * 1024), // Random free VRAM
        id: '0',
        name: 'NVIDIA GeForce RTX 3080',
        total_vram: 10 * 1024 * 1024 * 1024, // 10GB in bytes
        uuid: 'GPU-123456789-0',
        version: '7.5',
      },
      {
        activated: true,
        additional_information: {
          compute_cap: '8.6',
          driver_version: '535.129.03',
        },
        free_vram: Math.floor(Math.random() * 8 * 1024 * 1024 * 1024), // Random free VRAM
        id: '1',
        name: 'NVIDIA GeForce RTX 4070',
        total_vram: 12 * 1024 * 1024 * 1024, // 12GB in bytes
        uuid: 'GPU-123456789-1',
        version: '8.6',
      },
      {
        activated: false,
        additional_information: {
          compute_cap: '6.1',
          driver_version: '535.129.03',
        },
        free_vram: Math.floor(Math.random() * 6 * 1024 * 1024 * 1024), // Random free VRAM
        id: '2',
        name: 'NVIDIA GeForce GTX 1660 Ti',
        total_vram: 6 * 1024 * 1024 * 1024, // 6GB in bytes
        uuid: 'GPU-123456789-2',
        version: '6.1',
      },
    ],
    os: {
      name: 'macOS',
      version: '14.0',
    },
    ram: {
      available: Math.floor(Math.random() * 16 * 1024 * 1024 * 1024), // Random available RAM
      total: 32 * 1024 * 1024 * 1024, // 32GB in bytes
    },
  }
}

// Format bytes to a human-readable format
const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

function SortableGPUItem({ gpu, index }: { gpu: GPU; index: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: gpu.id || index })

  const { toggleGPUActivation } = useHardware()

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <div ref={setNodeRef} style={style} className="mb-4 last:mb-0">
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
          </div>
        }
        actions={
          <div className="flex items-center gap-4">
            <Switch
              checked={gpu.activated}
              onCheckedChange={() => toggleGPUActivation(index)}
            />
          </div>
        }
      />
      <div className="ml-8 mt-3">
        <CardItem
          title="VRAM"
          actions={
            <span className="text-main-view-fg/80">
              {formatBytes(gpu.free_vram)} free of {formatBytes(gpu.total_vram)}
            </span>
          }
        />
        <CardItem
          title="Driver Version"
          actions={
            <span className="text-main-view-fg/80">
              {gpu.additional_information.driver_version}
            </span>
          }
        />
        <CardItem
          title="Compute Capability"
          actions={
            <span className="text-main-view-fg/80">
              {gpu.additional_information.compute_cap}
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
    setHardwareData,
    updateCPUUsage,
    updateRAMAvailable,
    reorderGPUs,
  } = useHardware()

  // Set up DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor)
  )

  // Handle drag end event
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      // Find the indices of the dragged item and the drop target
      const oldIndex = hardwareData.gpus.findIndex(
        (gpu) => gpu.id === active.id
      )
      const newIndex = hardwareData.gpus.findIndex((gpu) => gpu.id === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderGPUs(oldIndex, newIndex)
      }
    }
  }

  useEffect(() => {
    const data = fetchHardwareData()
    setHardwareData(data)

    const intervalId = setInterval(() => {
      const newData = fetchHardwareData()
      updateCPUUsage(newData.cpu.usage)
      updateRAMAvailable(newData.ram.available)
    }, 5000)

    return () => clearInterval(intervalId)
  }, [setHardwareData, updateCPUUsage, updateRAMAvailable])

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common.settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* OS Information */}
            <Card title="Operating System">
              <CardItem
                title="Name"
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.os.name}
                  </span>
                }
              />
              <CardItem
                title="Version"
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.os.version}
                  </span>
                }
              />
            </Card>

            {/* CPU Information */}
            <Card title="CPU">
              <CardItem
                title="Model"
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu.model}
                  </span>
                }
              />
              <CardItem
                title="Architecture"
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu.arch}
                  </span>
                }
              />
              <CardItem
                title="Cores"
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu.cores}
                  </span>
                }
              />
              <CardItem
                title="Instructions"
                actions={
                  <span className="text-main-view-fg/80">
                    {hardwareData.cpu.instructions.join(', ')}
                  </span>
                }
              />
              <CardItem
                title="Usage"
                actions={
                  <div className="flex items-center gap-2">
                    <Progress
                      value={hardwareData.cpu.usage}
                      className="h-2 w-10"
                    />
                    <span className="text-main-view-fg/80">
                      {hardwareData.cpu.usage.toFixed(2)}%
                    </span>
                  </div>
                }
              />
            </Card>

            {/* RAM Information */}
            <Card title="Memory">
              <CardItem
                title="Total RAM"
                actions={
                  <span className="text-main-view-fg/80">
                    {formatBytes(hardwareData.ram.total)}
                  </span>
                }
              />
              <CardItem
                title="Available RAM"
                actions={
                  <span className="text-main-view-fg/80">
                    {formatBytes(hardwareData.ram.available)}
                  </span>
                }
              />
              <CardItem
                title="Usage"
                actions={
                  <div className="flex items-center gap-2">
                    <Progress
                      value={
                        ((hardwareData.ram.total - hardwareData.ram.available) /
                          hardwareData.ram.total) *
                        100
                      }
                      className="h-2 w-10"
                    />
                    <span className="text-main-view-fg/80">
                      {(
                        ((hardwareData.ram.total - hardwareData.ram.available) /
                          hardwareData.ram.total) *
                        100
                      ).toFixed(2)}
                      %
                    </span>
                  </div>
                }
              />
            </Card>

            {/* GPU Information */}
            <Card title="GPUs">
              {hardwareData.gpus.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={hardwareData.gpus.map((gpu) => gpu.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {hardwareData.gpus.map((gpu, index) => (
                      <SortableGPUItem
                        key={gpu.id || index}
                        gpu={gpu}
                        index={index}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                <CardItem title="No GPUs detected" actions={<></>} />
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
