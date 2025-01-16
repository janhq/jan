/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from 'react'

import { useState } from 'react'

import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { Gpu } from '@janhq/core'
import { Progress, ScrollArea, Switch } from '@janhq/joi'
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

import { ChevronDownIcon, GripVerticalIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import {
  useGetHardwareInfo,
  setActiveGpus,
} from '@/hooks/useHardwareManagement'

const gpusAtom = atomWithStorage<Gpu[]>('gpus', [])

export const showRightPanelAtom = atomWithStorage<Gpu[]>(
  'gpus',
  [],
  undefined,
  { getOnInit: true }
)

const Hardware = () => {
  const { hardware } = useGetHardwareInfo()
  const [openPanels, setOpenPanels] = useState<Record<number, boolean>>({})

  const [gpus, setGpus] = useAtom<Gpu[]>(gpusAtom)

  const togglePanel = (index: number) => {
    setOpenPanels((prev) => ({
      ...prev,
      [index]: !prev[index], // Toggle the specific panel
    }))
  }

  // Handle switch toggle for GPU activation
  const handleSwitchChange = async (index: number, isActive: boolean) => {
    const updatedGpus = gpus.map((gpu, i) =>
      i === index ? { ...gpu, activated: isActive } : gpu
    )
    setGpus(updatedGpus)
    // Call the API to update the active GPUs
    try {
      const activeGpuIds = updatedGpus
        .filter((gpu) => gpu.activated)
        .map((gpu) => Number(gpu.id))
      await setActiveGpus(activeGpuIds)
    } catch (error) {
      console.error('Failed to update active GPUs:', error)
    }
  }

  const handleDragEnd = (result: any) => {
    if (!result.destination) return
    const reorderedGpus = Array.from(gpus)
    const [movedGpu] = reorderedGpus.splice(result.source.index, 1)
    reorderedGpus.splice(result.destination.index, 0, movedGpu)
    setGpus(reorderedGpus) // Update the atom, which persists to localStorage
  }

  React.useEffect(() => {
    if (hardware?.gpus) {
      // Find GPUs that are not already in the state by UUID
      const newGpus = hardware.gpus.filter(
        (gpu) => !gpus.some((existingGpu) => existingGpu.uuid === gpu.uuid)
      )

      // Append new GPUs to the bottom of the current list
      if (newGpus.length > 0) {
        setGpus((prevGpus) => [...prevGpus, ...newGpus])
      }
    }
  }, [hardware?.gpus, gpus, setGpus])

  return (
    <ScrollArea className="h-full w-full px-4">
      <div className="block w-full py-4">
        {/* CPU */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">CPU</h6>
            </div>
          </div>
          <div className="w-full md:w-2/3">
            <div className="flex flex-col gap-2">
              <div className="flex w-full justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                <span>{hardware?.cpu.model}</span>
                <span>|</span>
                <span>Cores: {hardware?.cpu.cores}</span>
                <span>|</span>
                <span>Architecture: {hardware?.cpu.arch}</span>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={70} size="small" className="w-full" />
                <span className="font-medium">70%</span>
              </div>
            </div>
          </div>
        </div>
        {/* RAM */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">RAM</h6>
            </div>
          </div>
          <div className="w-full md:w-2/3">
            <div className="flex flex-col gap-2">
              <div className="flex w-full justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                <span>
                  {(
                    (Number(hardware?.ram.total) -
                      Number(hardware?.ram.available)) /
                    1024
                  ).toFixed(2)}
                  GB / {(Number(hardware?.ram.total) / 1024).toFixed(2)}GB
                </span>
                {hardware?.ram.type && (
                  <>
                    <span>|</span>
                    <span>Type: {hardware?.ram.type}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Progress
                  value={Math.round(
                    ((Number(hardware?.ram.total) -
                      Number(hardware?.ram.available)) /
                      Number(hardware?.ram.total)) *
                      100
                  )}
                  size="small"
                  className="w-full"
                />
                <span className="font-medium">
                  {Math.round(
                    ((Number(hardware?.ram.total) -
                      Number(hardware?.ram.available)) /
                      Number(hardware?.ram.total)) *
                      100
                  ).toFixed()}
                  %
                </span>
              </div>
            </div>
          </div>
        </div>
        {/* OS */}
        <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
          <div className="flex-shrink-0 space-y-1">
            <div className="flex gap-x-2">
              <h6 className="font-semibold capitalize">OS</h6>
            </div>
          </div>
          <div className="w-full md:w-2/3">
            <div className="flex flex-col gap-2">
              <div className="flex w-full justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                <span>{hardware?.os.name}</span>
                <span>|</span>
                <span>{hardware?.os.version}</span>
              </div>
            </div>
          </div>
        </div>
        {/* GPUs */}
        {!isMac && gpus.length > 0 && (
          <div className="flex w-full flex-col items-start justify-between gap-4 border-b border-[hsla(var(--app-border))] py-4 first:pt-0 last:border-none sm:flex-row">
            <div className="w-full flex-shrink-0">
              <div className="flex gap-x-2">
                <h6 className="font-semibold capitalize">GPUs</h6>
              </div>
              <p className="mt-1 font-medium leading-relaxed text-[hsla(var(--text-secondary))]">
                {`Enhance model performance by utilizing your device's GPU for
              acceleration.`}
              </p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="gpu-list">
                  {(provided) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className="mt-4"
                    >
                      {gpus.map((item, i) => (
                        <Draggable key={i} draggableId={String(i)} index={i}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={twMerge(
                                'cursor-pointer border border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg',
                                gpus.length > 1 && 'last:rounded-t-none',
                                snapshot.isDragging
                                  ? 'border-b'
                                  : 'border-b-0 last:border-b'
                              )}
                              onClick={() => togglePanel(i)}
                            >
                              <div className="flex flex-col items-start justify-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex w-full items-center justify-between">
                                  <div className="flex h-full flex-shrink-0 items-center gap-2">
                                    <GripVerticalIcon
                                      size={14}
                                      className="text-[hsla(var(--text-tertiary))]"
                                    />
                                    <div
                                      className={twMerge(
                                        'h-2 w-2 rounded-full',
                                        item.activated
                                          ? 'bg-green-400'
                                          : 'bg-neutral-300'
                                      )}
                                    />
                                    <h6 title={item.name}>{item.name}</h6>
                                  </div>
                                  <div className="flex flex-shrink-0 items-end gap-4">
                                    {item.activated && (
                                      <div className="flex w-40 items-center gap-3">
                                        <Progress
                                          value={Math.round(
                                            ((Number(item.total_vram) -
                                              Number(item.free_vram)) /
                                              Number(item.total_vram)) *
                                              100
                                          )}
                                          size="small"
                                          className="w-full"
                                        />
                                        <span className="font-medium">
                                          {Math.round(
                                            ((Number(item.total_vram) -
                                              Number(item.free_vram)) /
                                              Number(item.total_vram)) *
                                              100
                                          ).toFixed()}
                                          %
                                        </span>
                                      </div>
                                    )}

                                    <div className="flex justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                                      {item.activated && (
                                        <span>
                                          {(
                                            (Number(item.total_vram) -
                                              Number(item.free_vram)) /
                                            1024
                                          ).toFixed(2)}
                                          GB /{' '}
                                        </span>
                                      )}
                                      <span>
                                        {(
                                          Number(item.total_vram) / 1024
                                        ).toFixed(2)}
                                        GB
                                      </span>
                                    </div>

                                    <Switch
                                      checked={item.activated}
                                      onChange={(e) =>
                                        handleSwitchChange(i, e.target.checked)
                                      }
                                    />

                                    <ChevronDownIcon
                                      size={14}
                                      className={twMerge(
                                        'relative z-10 transform cursor-pointer transition-transform',
                                        openPanels[i]
                                          ? 'rotate-180'
                                          : 'rotate-0'
                                      )}
                                    />
                                  </div>
                                </div>
                              </div>

                              {openPanels[i] && (
                                <div className="space-y-4 p-4 pb-0 text-[hsla(var(--text-secondary))]">
                                  <div className="flex">
                                    <div className="w-[200px]">
                                      Driver Version
                                    </div>
                                    <span>
                                      {
                                        item.additional_information
                                          .driver_version
                                      }
                                    </span>
                                  </div>
                                  <div className="flex">
                                    <div className="w-[200px]">
                                      Compute Capability
                                    </div>
                                    <span>
                                      {item.additional_information.compute_cap}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

export default Hardware
