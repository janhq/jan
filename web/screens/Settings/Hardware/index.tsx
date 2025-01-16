/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from 'react'

import { useState } from 'react'

import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { Progress, ScrollArea, Switch } from '@janhq/joi'
import { ChevronDownIcon, GripVerticalIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

const dummy = [
  {
    active: true,
    name: 'Nvidia GeForce RTX 4070 Laptop GPU',
    memory: '12GB / 16GB',
    usage: 22,
  },
  {
    active: true,
    name: 'Nvidia GeForce GTX 1660 Ti',
    memory: '12GB / 16GB',
    usage: 15,
  },
  {
    active: true,
    name: 'Nvidia Quadro P5000',
    memory: '12GB / 16GB',
    usage: 70,
  },
  {
    active: false,
    name: 'AMD Radeon RX 6900 XT',
    memory: '8GB',
    usage: 0,
  },
  {
    active: false,
    name: 'AMD Radeon RX 6800 XT',
    memory: '8GB',
    usage: 0,
  },
]

const Hardware = () => {
  const [openPanels, setOpenPanels] = useState<Record<number, boolean>>({})
  const [data, setData] = useState(dummy)

  const togglePanel = (index: number) => {
    setOpenPanels((prev) => ({
      ...prev,
      [index]: !prev[index], // Toggle the specific panel
    }))
  }

  const handleSwitchChange = (index: number, isActive: boolean) => {
    setData((prevData) =>
      prevData.map((item, i) =>
        i === index
          ? {
              ...item,
              active: isActive, // Update the active state of the specific item
            }
          : item
      )
    )
  }

  const handleDragEnd = (result: any) => {
    if (!result.destination) return
    const items = Array.from(data)
    const [reorderedItem] = items.splice(result.source.index, 1)
    items.splice(result.destination.index, 0, reorderedItem)
    setData(items)
  }

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
          <div className="w-full md:w-1/2">
            <div className="flex flex-col gap-2">
              <div className="flex w-full justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                <span>Intel Core i9 12900K</span>
                <span>|</span>
                <span>Cores: 4</span>
                <span>|</span>
                <span>Architecture: x64</span>
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
          <div className="w-full md:w-1/2">
            <div className="flex flex-col gap-2">
              <div className="flex w-full justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                <span>12GB / 16.00 GB</span>
                <span>|</span>
                <span>Type: DDR4</span>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={84} size="small" className="w-full" />
                <span className="font-medium">84%</span>
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
          <div className="w-full md:w-1/2">
            <div className="flex flex-col gap-2">
              <div className="flex w-full justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                <span>Windows 10 Pro</span>
                <span>|</span>
                <span>Version: 10.2</span>
              </div>
            </div>
          </div>
        </div>
        {/* GPUs */}
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
                    {data.map((item, i) => (
                      <Draggable key={i} draggableId={String(i)} index={i}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={twMerge(
                              'cursor-pointer border border-[hsla(var(--app-border))] bg-[hsla(var(--tertiary-bg))] p-4 first:rounded-t-lg last:rounded-b-lg last:rounded-t-none ',
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
                                      item.active
                                        ? 'bg-green-400'
                                        : 'bg-neutral-300'
                                    )}
                                  />
                                  <h6 title={item.name}>{item.name}</h6>
                                </div>
                                <div className="flex flex-shrink-0 items-end gap-4">
                                  {item.active && (
                                    <div className="flex w-40 items-center gap-3">
                                      <Progress
                                        value={item.usage}
                                        size="small"
                                        className="w-full"
                                      />
                                      <span className="font-medium">
                                        {item.usage}%
                                      </span>
                                    </div>
                                  )}

                                  <div className="flex justify-end gap-2 text-xs text-[hsla(var(--text-secondary))]">
                                    <span>{item.memory}</span>
                                  </div>

                                  <Switch
                                    checked={item.active}
                                    onChange={(e) =>
                                      handleSwitchChange(i, e.target.checked)
                                    }
                                  />

                                  <ChevronDownIcon
                                    size={14}
                                    className={twMerge(
                                      'transform cursor-pointer transition-transform',
                                      openPanels[i] ? 'rotate-180' : 'rotate-0'
                                    )}
                                    onClick={() => togglePanel(i)}
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
                                  <span>552.12</span>
                                </div>
                                <div className="flex">
                                  <div className="w-[200px]">
                                    Compute Capability
                                  </div>
                                  <span>552.12</span>
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
      </div>
    </ScrollArea>
  )
}

export default Hardware
