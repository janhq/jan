import { Fragment, useCallback, useState } from 'react'

import { Progress } from '@janhq/joi'
import { useAtom, useAtomValue } from 'jotai'
import {
  MonitorIcon,
  XIcon,
  ChevronDown,
  ChevronUp,
  FolderOpenIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import useGetSystemResources from '@/hooks/useGetSystemResources'

import { usePath } from '@/hooks/usePath'

import { toGigabytes } from '@/utils/converter'

import { utilizedMemory } from '@/utils/memory'

import TableActiveModel from './TableActiveModel'

import { showSystemMonitorPanelAtom } from '@/helpers/atoms/App.atom'
import { reduceTransparentAtom } from '@/helpers/atoms/Setting.atom'
import {
  cpuUsageAtom,
  gpusAtom,
  ramUtilitizedAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

const SystemMonitor = () => {
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)
  const cpuUsage = useAtomValue(cpuUsageAtom)
  const gpus = useAtomValue(gpusAtom)
  const { onRevealInFinder } = usePath()
  const [showFullScreen, setShowFullScreen] = useState(false)
  const ramUtilitized = useAtomValue(ramUtilitizedAtom)
  const [showSystemMonitorPanel, setShowSystemMonitorPanel] = useAtom(
    showSystemMonitorPanelAtom
  )

  const reduceTransparent = useAtomValue(reduceTransparentAtom)

  const { watch, stopWatching } = useGetSystemResources()

  const toggleShowSystemMonitorPanel = useCallback(
    (isShow: boolean) => {
      setShowSystemMonitorPanel(isShow)
      if (isShow) {
        watch()
      } else {
        stopWatching()
      }
    },
    [setShowSystemMonitorPanel, stopWatching, watch]
  )

  return (
    <Fragment>
      <div
        data-testid="system-monitoring"
        className={twMerge(
          'flex cursor-pointer items-center gap-x-1 rounded px-1 py-0.5 hover:bg-[hsla(var(--secondary-bg))]',
          showSystemMonitorPanel && 'bg-[hsla(var(--secondary-bg))]'
        )}
        onClick={() => {
          toggleShowSystemMonitorPanel(!showSystemMonitorPanel)
          setShowFullScreen(false)
        }}
      >
        <MonitorIcon size={12} className="text-[hsla(var(--text-primary))]" />
        <span className="font-medium">System Monitor</span>
      </div>
      {showSystemMonitorPanel && (
        <div
          className={twMerge(
            'system-monitor-panel fixed bottom-9 left-[49px] z-50 flex w-[calc(100%-48px)] flex-shrink-0 flex-col border-t border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))]',
            showFullScreen && 'h-[calc(100%-63px)]',
            reduceTransparent && 'w-[calc(100%-48px)] rounded-none'
          )}
        >
          <div className="flex h-8 flex-shrink-0 items-center justify-between border-b border-[hsla(var(--app-border))] px-4">
            <h6 className="font-medium text-[hsla(var(--text-primary))]">
              Running Models
            </h6>
            <div className="unset-drag flex cursor-pointer items-center gap-x-2">
              <div
                className="flex cursor-pointer items-center gap-x-1 rounded px-1 py-0.5 hover:bg-[hsla(var(--secondary-bg))]"
                onClick={() => onRevealInFinder('Logs')}
              >
                <FolderOpenIcon size={12} /> App Log
              </div>
              {showFullScreen ? (
                <ChevronDown
                  size={20}
                  className="text-[hsla(var(--text-secondary))]"
                  onClick={() => setShowFullScreen(!showFullScreen)}
                />
              ) : (
                <ChevronUp
                  size={20}
                  className="text-[hsla(var(--text-secondary))]"
                  onClick={() => setShowFullScreen(!showFullScreen)}
                />
              )}
              <XIcon
                size={16}
                className="text-[hsla(var(--text-secondary))]"
                onClick={() => {
                  toggleShowSystemMonitorPanel(false)
                  setShowFullScreen(false)
                }}
              />
            </div>
          </div>

          <div className="flex h-full gap-y-4">
            <TableActiveModel />

            <div className="w-1/2 border-l border-[hsla(var(--app-border))] p-4">
              <div className="mb-4 border-b border-[hsla(var(--app-border))] pb-4">
                <h6 className="font-bold">CPU</h6>
                <div className="flex items-center gap-x-4">
                  <Progress value={cpuUsage} className="w-full" size="small" />
                  <span className="flex-shrink-0 ">{cpuUsage}%</span>
                </div>
              </div>
              <div className="mb-4 border-b border-[hsla(var(--app-border))] pb-4">
                <div className="flex items-center justify-between gap-2">
                  <h6 className="font-bold">Memory</h6>
                  <span>
                    {toGigabytes(usedRam, { hideUnit: true })}GB /{' '}
                    {toGigabytes(totalRam, { hideUnit: true })}GB
                  </span>
                </div>
                <div className="flex items-center gap-x-4">
                  <Progress
                    value={Math.round((usedRam / totalRam) * 100)}
                    className="w-full"
                    size="small"
                  />
                  <span className="flex-shrink-0 ">{ramUtilitized}%</span>
                </div>
              </div>
              {gpus.length > 0 && (
                <div className="mb-4 border-b border-[hsla(var(--app-border))] pb-4 last:border-none">
                  {gpus
                    .filter((gpu) => gpu.activated === true)
                    .map((gpu, index) => {
                      const gpuUtilization = utilizedMemory(
                        gpu.free_vram,
                        gpu.total_vram
                      )
                      return (
                        <div key={index} className="mt-4 flex flex-col gap-x-2">
                          <div className="flex w-full items-start justify-between">
                            <span className="line-clamp-1 w-1/2 font-bold">
                              {gpu.name}
                            </span>
                            <div className="flex gap-x-2">
                              <div className="">
                                <span>
                                  {gpu.total_vram - gpu.free_vram}/
                                  {gpu.total_vram}
                                </span>
                                <span> MB</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-x-4">
                            <Progress
                              value={gpuUtilization}
                              className="w-full"
                              size="small"
                            />
                            <span className="flex-shrink-0 ">
                              {gpuUtilization}%
                            </span>
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Fragment>
  )
}

export default SystemMonitor
