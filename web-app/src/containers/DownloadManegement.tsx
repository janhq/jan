import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useModelProvider } from '@/hooks/useModelProvider'
import { abortDownload } from '@/services/models'
import { getProviders } from '@/services/providers'
import { DownloadEvent, DownloadState, events } from '@janhq/core'
import { IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo } from 'react'

export function DownloadManagement() {
  const { setProviders } = useModelProvider()
  const { downloads, updateProgress, removeDownload } = useDownloadStore()
  const downloadCount = useMemo(
    () => Object.keys(downloads).length,
    [downloads]
  )
  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.id,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  const overallProgress = useMemo(() => {
    const total = downloadProcesses.reduce((acc, download) => {
      return acc + download.total
    }, 0)
    const current = downloadProcesses.reduce((acc, download) => {
      return acc + download.current
    }, 0)
    return total > 0 ? current / total : 0
  }, [downloadProcesses])

  const onFileDownloadUpdate = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadUpdate', state)
      updateProgress(
        state.modelId,
        state.percent,
        state.modelId,
        state.size?.transferred,
        state.size?.total
      )
    },
    [updateProgress]
  )

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadError', state)
      removeDownload(state.modelId)
    },
    [removeDownload]
  )

  const onFileDownloadStopped = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadError', state)
      removeDownload(state.modelId)
    },
    [removeDownload]
  )

  const onFileDownloadSuccess = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadSuccess', state)
      removeDownload(state.modelId)
      getProviders().then(setProviders)
    },
    [removeDownload, setProviders]
  )

  useEffect(() => {
    console.debug('DownloadListener: registering event listeners...')
    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)

    return () => {
      console.debug('DownloadListener: unregistering event listeners...')
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
    }
  }, [
    onFileDownloadUpdate,
    onFileDownloadError,
    onFileDownloadSuccess,
    onFileDownloadStopped,
  ])

  function renderGB(bytes: number): string {
    const gb = bytes / 1024 ** 3
    return ((gb * 100) / 100).toFixed(2)
  }

  return (
    <Popover>
      {downloadCount > 0 && (
        <PopoverTrigger>
          <div className="bg-left-panel-fg/10 hover:bg-left-panel-fg/12 p-2 rounded-md my-1 relative border border-left-panel-fg/10 cursor-pointer text-left">
            <div className="bg-primary font-bold size-5 rounded-full absolute -top-2 -right-1 flex items-center justify-center text-primary-fg">
              {downloadCount}
            </div>
            <p className="text-left-panel-fg/80 font-medium">Downloads</p>
            <div className="mt-2 flex items-center justify-between space-x-2">
              <Progress value={overallProgress * 100} />
              <span className="text-xs font-medium text-main-view-fg/80 shrink-0">
                {overallProgress.toFixed(2)}%
              </span>
            </div>
          </div>
        </PopoverTrigger>
      )}
      <PopoverContent
        side="right"
        align="end"
        className="p-0 overflow-hidden text-sm select-none"
        sideOffset={6}
      >
        <div className="flex flex-col">
          <div className="p-2 py-1.5 bg-main-view-fg/5 border-b border-main-view-fg/6">
            <p className="text-xs text-main-view-fg/70">Downloading</p>
          </div>
          <div className="p-2 max-h-[300px] overflow-y-auto space-y-2">
            {downloadProcesses.map((download) => (
              <div className="bg-main-view-fg/4 rounded-md p-2">
                <div className="flex items-center justify-between">
                  <p className="truncate text-main-view-fg/80">
                    {download.name}
                  </p>
                  <div className="shrink-0 flex items-center space-x-0.5">
                    {/* <IconPlayerPauseFilled
                      size={16}
                      className="text-main-view-fg/70 cursor-pointer"
                      title="Pause download"
                    /> */}
                    <IconX
                      size={16}
                      className="text-main-view-fg/70 cursor-pointer"
                      title="Cancel download"
                      onClick={() => abortDownload(download.name)}
                    />
                  </div>
                </div>
                <Progress value={download.progress * 100} className="my-2" />
                <p className="text-main-view-fg/60 text-xs">
                  {`${renderGB(download.current)} / ${renderGB(download.total)}`}{' '}
                  GB ({download.progress.toFixed(2)}%)
                </p>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
