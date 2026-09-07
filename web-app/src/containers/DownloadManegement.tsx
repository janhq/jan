import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { events, AppEvent } from '@janhq/core'
import { IconPlayerPause, IconPlayerPlay, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/utils'

export function DownloadManagement() {
  const { t } = useTranslation()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const serviceHub = useServiceHub()
  const {
    downloads,
    localDownloadingModels,
    removeDownload,
    removeLocalDownloadingModel,
    setPaused,
    addLocalDownloadingModel,
  } = useDownloadStore()
  const { updateState } = useAppUpdater()

  const [appUpdateState, setAppUpdateState] = useState({
    isDownloading: false,
    downloadProgress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
  })

  useEffect(() => {
    setAppUpdateState({
      isDownloading: updateState.isDownloading,
      downloadProgress: updateState.downloadProgress,
      downloadedBytes: updateState.downloadedBytes,
      totalBytes: updateState.totalBytes,
    })
  }, [updateState])

  const onAppUpdateDownloadUpdate = useCallback(
    (data: {
      progress?: number
      downloadedBytes?: number
      totalBytes?: number
    }) => {
      setAppUpdateState((prev) => ({
        ...prev,
        isDownloading: true,
        downloadProgress: data.progress || 0,
        downloadedBytes: data.downloadedBytes || 0,
        totalBytes: data.totalBytes || 0,
      }))
    },
    []
  )

  const onAppUpdateDownloadSuccess = useCallback(() => {
    setAppUpdateState((prev) => ({
      ...prev,
      isDownloading: false,
      downloadProgress: 1,
    }))
    toast.success(t('common:toast.appUpdateDownloaded.title'), {
      description: t('common:toast.appUpdateDownloaded.description'),
    })
  }, [t])

  const onAppUpdateDownloadError = useCallback(() => {
    setAppUpdateState((prev) => ({
      ...prev,
      isDownloading: false,
    }))
    toast.error(t('common:toast.appUpdateDownloadFailed.title'), {
      description: t('common:toast.appUpdateDownloadFailed.description'),
    })
  }, [t])

  const downloadProcesses = useMemo(() => {
    // Get downloads with progress data
    const downloadsWithProgress = Object.values(downloads).map((download) => ({
      id: download.name,
      name: download.name,
      progress: download.progress,
      current: download.current,
      total: download.total,
      paused: download.paused ?? false,
    }))

    // Add local downloading models that don't have progress data yet
    const localDownloadsWithoutProgress = Array.from(localDownloadingModels)
      .filter((modelId) => !downloads[modelId]) // Only include models not in downloads
      .map((modelId) => ({
        id: modelId,
        name: modelId,
        progress: 0,
        current: 0,
        total: 0,
        paused: false,
      }))

    return [...downloadsWithProgress, ...localDownloadsWithoutProgress]
  }, [downloads, localDownloadingModels])

  const downloadCount = useMemo(() => {
    const modelDownloads = downloadProcesses.length
    const appUpdateDownload = appUpdateState.isDownloading ? 1 : 0
    const total = modelDownloads + appUpdateDownload
    return total
  }, [downloadProcesses, appUpdateState.isDownloading])

  const overallProgress = useMemo(() => {
    const modelTotal = downloadProcesses.reduce((acc, download) => {
      return acc + download.total
    }, 0)
    const modelCurrent = downloadProcesses.reduce((acc, download) => {
      return acc + download.current
    }, 0)

    // Include app update progress in overall calculation
    const appUpdateTotal = appUpdateState.isDownloading
      ? appUpdateState.totalBytes
      : 0
    const appUpdateCurrent = appUpdateState.isDownloading
      ? appUpdateState.downloadedBytes
      : 0

    const total = modelTotal + appUpdateTotal
    const current = modelCurrent + appUpdateCurrent

    return total > 0 ? current / total : 0
  }, [
    downloadProcesses,
    appUpdateState.isDownloading,
    appUpdateState.totalBytes,
    appUpdateState.downloadedBytes,
  ])

  const handlePauseDownload = useCallback(
    async (id: string) => {
      setPaused(id, true)
      try {
        await serviceHub.models().pauseDownload(id)
      } catch (e) {
        setPaused(id, false)
        console.error('Failed to pause download:', id, e)
      }
    },
    [setPaused, serviceHub]
  )

  const handleResumeDownload = useCallback(
    async (id: string) => {
      const params = useDownloadStore.getState().resumeParams[id]
      if (!params) {
        toast.error(t('common:toast.downloadFailed.title'), {
          description: t('hub:resumeUnavailable', {
            defaultValue: 'Cannot resume this download. Please start it again.',
          }),
        })
        return
      }
      setPaused(id, false)
      addLocalDownloadingModel(id)
      try {
        await serviceHub
          .models()
          .pullModelWithMetadata(
            id,
            params.modelPath,
            params.mmprojPath,
            params.hfToken
          )
      } catch (e) {
        console.error('Failed to resume download:', id, e)
      }
    },
    [setPaused, addLocalDownloadingModel, serviceHub, t]
  )

  const handleCancelDownload = useCallback(
    (id: string, name: string) => {
      removeDownload(id)
      removeLocalDownloadingModel(id)
      if (id.startsWith('llamacpp') || id.startsWith('mlx')) {
        const downloadManager = window.core.extensionManager.getByName(
          '@janhq/download-extension'
        )
        downloadManager.cancelDownload(id)
      } else {
        serviceHub
          .models()
          .abortDownload(name)
          .then(() => {
            toast.info(t('common:toast.downloadCancelled.title'), {
              id: 'cancel-download',
              description: t('common:toast.downloadCancelled.description'),
            })
          })
      }
      setIsPopoverOpen(false)
    },
    [removeDownload, removeLocalDownloadingModel, serviceHub, t]
  )

  useEffect(() => {
    events.on(AppEvent.onAppUpdateDownloadUpdate, onAppUpdateDownloadUpdate)
    events.on(AppEvent.onAppUpdateDownloadSuccess, onAppUpdateDownloadSuccess)
    events.on(AppEvent.onAppUpdateDownloadError, onAppUpdateDownloadError)

    return () => {
      events.off(AppEvent.onAppUpdateDownloadUpdate, onAppUpdateDownloadUpdate)
      events.off(
        AppEvent.onAppUpdateDownloadSuccess,
        onAppUpdateDownloadSuccess
      )
      events.off(AppEvent.onAppUpdateDownloadError, onAppUpdateDownloadError)
    }
  }, [
    onAppUpdateDownloadUpdate,
    onAppUpdateDownloadSuccess,
    onAppUpdateDownloadError,
  ])

  return (
    <>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground z-50 rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 size-7 relative">
            <DownloadIcon className='text-muted-foreground size-4' />
            {downloadCount > 0 && (
              <svg className="absolute inset-0 size-7 -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-primary/30"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-primary"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${overallProgress * 100}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          align="start"
          className="p-0 overflow-hidden text-sm select-none rounded-2xl"
          sideOffset={6}
          collisionPadding={8}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <div className="flex flex-col">
            {appUpdateState.isDownloading || downloadProcesses.length > 0 ? (
              <>
                <div className="px-3 pt-2 flex items-center justify-between">
                  <p>
                    {t('downloading')}
                  </p>
                </div>
                <div className="p-2 max-h-[300px] overflow-y-auto space-y-2">
                  {appUpdateState.isDownloading && (
                    <div className="rounded-lg p-2 bg-secondary">
                      <div className="flex items-center justify-between">
                        <p className="truncate">
                          App Update
                        </p>
                      </div>
                      <div className="relative z-40">
                        <Progress
                          value={appUpdateState.downloadProgress * 100}
                          className="my-2 h-6 bg-muted-foreground/10 relative rounded-md"
                        />
                        <div className="absolute w-full top-1/2 transform -translate-y-1/2 flex items-center justify-between px-2">
                          <p className="text-xs">
                            {Math.round(appUpdateState.downloadProgress * 100)}
                            %
                          </p>
                          <p className="text-xs">
                            {`${formatBytes(appUpdateState.downloadedBytes, {
                              hideUnit: true,
                              minUnit: 'GB',
                              decimals: 2,
                            })} / ${formatBytes(appUpdateState.totalBytes, {
                              hideUnit: true,
                              minUnit: 'GB',
                              decimals: 2,
                            })}`}{' '}
                            GB
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {downloadProcesses.map((download) => (
                    <div
                      key={download.id}
                      className="rounded-lg p-2 bg-secondary"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate">
                          {download.name}
                        </p>
                        <div className="shrink-0 flex items-center space-x-0.5">
                          {!download.id.startsWith('llamacpp') &&
                            !download.id.startsWith('mlx') &&
                            (download.paused ? (
                              <Button
                                variant="secondary"
                                size="icon-xs"
                                onClick={() =>
                                  handleResumeDownload(download.id)
                                }
                              >
                                <IconPlayerPlay
                                  size={16}
                                  className="text-muted-foreground cursor-pointer"
                                  title="Resume download"
                                />
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="icon-xs"
                                onClick={() => handlePauseDownload(download.id)}
                              >
                                <IconPlayerPause
                                  size={16}
                                  className="text-muted-foreground cursor-pointer"
                                  title="Pause download"
                                />
                              </Button>
                            ))}
                          <Button
                            variant="secondary"
                            size="icon-xs"
                            onClick={() =>
                              handleCancelDownload(download.id, download.name)
                            }
                          >
                            <IconX
                              size={16}
                              className="text-muted-foreground cursor-pointer"
                              title="Cancel download"
                            />
                          </Button>
                        </div>
                      </div>
                      <div className="relative z-40">
                        <Progress
                          value={download.progress * 100}
                          className="my-2 h-6 bg-muted-foreground/10 relative rounded-md"
                        />
                        <div className="absolute w-full top-1/2 transform -translate-y-1/2 flex items-center justify-between px-2">
                          <p className="text-xs">
                            {download.paused
                              ? download.total > 0
                                ? `Paused · ${Math.round(download.progress * 100)}%`
                                : 'Paused'
                              : download.total > 0
                                ? `${Math.round(download.progress * 100)}%`
                                : download.current > 0
                                  ? 'Downloading...'
                                  : 'Initializing download...'}
                          </p>
                          <p className="text-xs">
                            {download.total > 0
                              ? `${formatBytes(download.current, {
                                hideUnit: true,
                                minUnit: 'GB',
                                decimals: 2,
                              })} / ${formatBytes(download.total, {
                                hideUnit: true,
                                minUnit: 'GB',
                                decimals: 2,
                              })} GB`
                              : download.current > 0 ?
                                `${formatBytes(download.current, {
                                  hideUnit: true,
                                  minUnit: 'GB',
                                  decimals: 2,
                                })} GB` : ''
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-3 py-8 flex flex-col items-center justify-center text-center space-y-2">
                <DownloadIcon className="text-muted-foreground/50 size-6" />
                <p className="text-muted-foreground leading-normal">
                  Your download progress <br /> will appear here
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
