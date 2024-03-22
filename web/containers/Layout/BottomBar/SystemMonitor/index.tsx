import { Fragment, useEffect, useState } from 'react'

import { Progress } from '@janhq/uikit'
import { useAtom, useAtomValue } from 'jotai'
import { MonitorIcon, XIcon, ChevronDown, ChevronUp } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { useClickOutside } from '@/hooks/useClickOutside'
import useGetSystemResources from '@/hooks/useGetSystemResources'

import { toGibibytes } from '@/utils/converter'

import TableActiveModel from './TableActiveModel'

import {
  cpuUsageAtom,
  gpusAtom,
  ramUtilitizedAtom,
  systemMonitorCollapseAtom,
  totalRamAtom,
  usedRamAtom,
} from '@/helpers/atoms/SystemBar.atom'

const SystemMonitor = () => {
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)
  const cpuUsage = useAtomValue(cpuUsageAtom)
  const gpus = useAtomValue(gpusAtom)
  const [showFullScreen, setShowFullScreen] = useState(false)
  const ramUtilitized = useAtomValue(ramUtilitizedAtom)
  const [systemMonitorCollapse, setSystemMonitorCollapse] = useAtom(
    systemMonitorCollapseAtom
  )
  const [control, setControl] = useState<HTMLDivElement | null>(null)
  const [elementExpand, setElementExpand] = useState<HTMLDivElement | null>(
    null
  )

  const { watch, stopWatching } = useGetSystemResources()
  useClickOutside(
    () => {
      setSystemMonitorCollapse(false)
      setShowFullScreen(false)
    },
    null,
    [control, elementExpand]
  )

  useEffect(() => {
    // Watch for resource update
    watch()

    return () => {
      stopWatching()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Fragment>
      <div
        ref={setControl}
        className={twMerge(
          'flex cursor-pointer items-center gap-x-2 rounded-md p-2 hover:bg-secondary',
          systemMonitorCollapse && 'bg-secondary'
        )}
        onClick={() => {
          setSystemMonitorCollapse(!systemMonitorCollapse)
          setShowFullScreen(false)
        }}
      >
        <MonitorIcon size={16} />
        <span className="text-xs font-medium">System Monitor</span>
      </div>
      {systemMonitorCollapse && (
        <div
          ref={setElementExpand}
          className={twMerge(
            'fixed bottom-12 left-16 z-50 flex w-[calc(100%-64px)] flex-shrink-0 flex-col border-t border-border bg-background',
            showFullScreen && 'h-[calc(100%-48px)]'
          )}
        >
          <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-4">
            <h6 className="font-bold">Running Models</h6>
            <div className="unset-drag flex items-center gap-x-2">
              {showFullScreen ? (
                <ChevronDown
                  size={20}
                  className="cursor-pointer text-muted-foreground"
                  onClick={() => setShowFullScreen(!showFullScreen)}
                />
              ) : (
                <ChevronUp
                  size={20}
                  className="cursor-pointer text-muted-foreground"
                  onClick={() => setShowFullScreen(!showFullScreen)}
                />
              )}
              <XIcon
                size={16}
                className="cursor-pointer text-muted-foreground"
                onClick={() => {
                  setSystemMonitorCollapse(false)
                  setShowFullScreen(false)
                }}
              />
            </div>
          </div>
          <div className="flex h-full gap-4">
            <TableActiveModel />
            <div className="w-full border-l border-border p-4">
              <div className="mb-4 border-b border-border pb-4">
                <h6 className="font-bold">CPU</h6>
                <div className="flex items-center gap-x-4">
                  <Progress value={cpuUsage} className="h-2" />
                  <span className="flex-shrink-0 text-muted-foreground">
                    {cpuUsage}%
                  </span>
                </div>
              </div>
              <div className="mb-4 border-b border-border pb-4">
                <div className="flex items-center justify-between gap-2">
                  <h6 className="font-bold">Memory</h6>
                  <span className="text-sm text-muted-foreground">
                    {toGibibytes(usedRam, { hideUnit: true })}/
                    {toGibibytes(totalRam, { hideUnit: true })} GB
                  </span>
                </div>
                <div className="flex items-center gap-x-4">
                  <Progress
                    value={Math.round((usedRam / totalRam) * 100)}
                    className="h-2"
                  />
                  <span className="flex-shrink-0 text-muted-foreground">
                    {ramUtilitized}%
                  </span>
                </div>
              </div>
              {gpus.length > 0 && (
                <div className="mb-4 border-b border-border pb-4 last:border-none">
                  {gpus.map((gpu, index) => (
                    <div key={index} className="mt-4 flex flex-col gap-x-2">
                      <div className="flex w-full items-start justify-between">
                        <span className="line-clamp-1 w-1/2 font-bold">
                          {gpu.name}
                        </span>
                        <div className="flex gap-x-2">
                          <div className="text-muted-foreground">
                            <span>
                              {gpu.memoryTotal - gpu.memoryFree}/
                              {gpu.memoryTotal}
                            </span>
                            <span> MB</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-x-4">
                        <Progress value={gpu.utilization} className="h-2" />
                        <span className="flex-shrink-0 text-muted-foreground">
                          {gpu.utilization}%
                        </span>
                      </div>
                    </div>
                  ))}
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
