import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { DownloadEvent, DownloadState, events, AppEvent } from '@janhq/core'
import { IconDownload, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'

export function DownloadManagement() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { open: isLeftPanelOpen } = useLeftPanel()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const serviceHub = useServiceHub()
  const {
    downloads,
    updateProgress,
    localDownloadingModels,
    removeDownload,
    removeLocalDownloadingModel,
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
      removeLocalDownloadingModel(state.modelId)

      const anyState = state as unknown as { error?: string }
      const err = anyState?.error || ''

      if (err.includes('HTTP status 401')) {
        toast.error('Hugging Face token required', {
          id: 'download-failed',
          description:
            'This model requires a Hugging Face access token. Add your token in Settings and retry.',
          action: {
            label: 'Open Settings',
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      if (err.includes('HTTP status 403')) {
        toast.error('Accept model license on Hugging Face', {
          id: 'download-failed',
          description:
            'You must accept the model’s license on its Hugging Face page before downloading.',
        })
        return
      }

      if (err.includes('HTTP status 429')) {
        toast.error('Rate limited by Hugging Face', {
          id: 'download-failed',
          description:
            'You have been rate-limited. Adding a token can increase rate limits. Please try again later.',
          action: {
            label: 'Open Settings',
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      toast.error(t('common:toast.downloadFailed.title'), {
        id: 'download-failed',
        description: t('common:toast.downloadFailed.description', {
          item: state.modelId,
        }),
      })
    },
    [removeDownload, removeLocalDownloadingModel, t, navigate]
  )

  const onModelValidationStarted = useCallback(
    (event: { modelId: string; downloadType: string }) => {
      console.debug('onModelValidationStarted', event)

      // Show validation in progress toast
      toast.info(t('common:toast.modelValidationStarted.title'), {
        id: `model-validation-started-${event.modelId}`,
        description: t('common:toast.modelValidationStarted.description', {
          modelId: event.modelId,
        }),
        duration: Infinity,
      })
    },
    [t]
  )

  const onModelValidationFailed = useCallback(
    (event: { modelId: string; error: string; reason: string }) => {
      console.debug('onModelValidationFailed', event)

      // Dismiss the validation started toast
      toast.dismiss(`model-validation-started-${event.modelId}`)

      removeDownload(event.modelId)
      removeLocalDownloadingModel(event.modelId)

      // Show specific toast for validation failure
      toast.error(t('common:toast.modelValidationFailed.title'), {
        description: t('common:toast.modelValidationFailed.description', {
          modelId: event.modelId,
        }),
        duration: 30000,
      })
    },
    [removeDownload, removeLocalDownloadingModel, t]
  )

  const onFileDownloadStopped = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadStopped', state)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    },
    [removeDownload, removeLocalDownloadingModel]
  )

  const onFileDownloadSuccess = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadSuccess', state)

      // Dismiss any validation started toast when download completes successfully
      toast.dismiss(`model-validation-started-${state.modelId}`)

      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      toast.success(t('common:toast.downloadComplete.title'), {
        id: 'download-complete',
        description: t('common:toast.downloadComplete.description', {
          item: state.modelId,
        }),
      })
    },
    [removeDownload, removeLocalDownloadingModel, t]
  )

  const onFileDownloadAndVerificationSuccess = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadAndVerificationSuccess', state)

      // Dismiss any validation started toast when download and verification complete successfully
      toast.dismiss(`model-validation-started-${state.modelId}`)

      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      toast.success(t('common:toast.downloadAndVerificationComplete.title'), {
        id: 'download-complete',
        description: t(
          'common:toast.downloadAndVerificationComplete.description',
          {
            item: state.modelId,
          }
        ),
      })
    },
    [removeDownload, removeLocalDownloadingModel, t]
  )

  useEffect(() => {
    console.debug('DownloadListener: registering event listeners...')
    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
    events.on(DownloadEvent.onModelValidationStarted, onModelValidationStarted)
    events.on(DownloadEvent.onModelValidationFailed, onModelValidationFailed)
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      onFileDownloadAndVerificationSuccess
    )

    // Register app update event listeners
    events.on(AppEvent.onAppUpdateDownloadUpdate, onAppUpdateDownloadUpdate)
    events.on(AppEvent.onAppUpdateDownloadSuccess, onAppUpdateDownloadSuccess)
    events.on(AppEvent.onAppUpdateDownloadError, onAppUpdateDownloadError)

    return () => {
      console.debug('DownloadListener: unregistering event listeners...')
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
      events.off(
        DownloadEvent.onModelValidationStarted,
        onModelValidationStarted
      )
      events.off(DownloadEvent.onModelValidationFailed, onModelValidationFailed)
      events.off(
        DownloadEvent.onFileDownloadAndVerificationSuccess,
        onFileDownloadAndVerificationSuccess
      )

      // Unregister app update event listeners
      events.off(AppEvent.onAppUpdateDownloadUpdate, onAppUpdateDownloadUpdate)
      events.off(
        AppEvent.onAppUpdateDownloadSuccess,
        onAppUpdateDownloadSuccess
      )
      events.off(AppEvent.onAppUpdateDownloadError, onAppUpdateDownloadError)
    }
  }, [
    onFileDownloadUpdate,
    onFileDownloadError,
    onFileDownloadSuccess,
    onFileDownloadStopped,
    onModelValidationStarted,
    onModelValidationFailed,
    onFileDownloadAndVerificationSuccess,
    onAppUpdateDownloadUpdate,
    onAppUpdateDownloadSuccess,
    onAppUpdateDownloadError,
  ])

  function renderGB(bytes: number): string {
    const gb = bytes / 1024 ** 3
    return ((gb * 100) / 100).toFixed(2)
  }

  return (
    <>
      {downloadCount > 0 && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            {isLeftPanelOpen ? (
<<<<<<< HEAD
              <div className="bg-left-panel-fg/10 hover:bg-left-panel-fg/12 p-2 rounded-md my-1 relative border border-left-panel-fg/10 cursor-pointer text-left">
                <div className="text-left-panel-fg/80 font-medium flex gap-2">
                  <span>{t('downloads')}</span>
                  <span>
                    <div className="bg-primary font-bold size-5 rounded-full  flex items-center justify-center text-primary-fg">
                      {downloadCount}
                    </div>
                  </span>
=======
              <div className="p-2 rounded-md my-1 relative border cursor-pointer text-left">
                <div className="font-studio font-medium flex gap-2 items-center justify-between">
                  <span className='text-sm'>{t('downloads')}</span>
                  <div className="bg-primary/50 font-bold size-4 rounded-full  flex items-center justify-center text-xs">
                    <span>{downloadCount}</span>
                  </div>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                </div>
                <div className="mt-2 flex items-center justify-between space-x-2">
                  <Progress value={overallProgress * 100} />
                  <span className="text-xs font-medium text-left-panel-fg/80 shrink-0">
                    {Math.round(overallProgress * 100)}%
                  </span>
                </div>
              </div>
            ) : (
<<<<<<< HEAD
              <div className="fixed bottom-4 left-4 z-50 size-10 bg-main-view border-2 border-main-view-fg/10 rounded-full shadow-md cursor-pointer flex items-center justify-center">
                <div className="relative">
                  <IconDownload
                    className="text-main-view-fg/50 -mt-1"
                    size={20}
                  />
                  <div className="bg-primary font-bold size-5 rounded-full absolute -top-4 -right-4 flex items-center justify-center text-primary-fg">
                    {downloadCount}
=======
              <div className="fixed bottom-4 left-4 z-50 size-10 border-2 rounded-full shadow-md cursor-pointer flex items-center justify-center">
                <div className="relative">
                  <IconDownload
                    className="text-muted-foreground -mt-1"
                    size={20}
                  />
                  <div className="bg-primary font-bold size-5 rounded-full absolute -top-4 -right-4 flex items-center justify-center text-xs">
                    <span>{downloadCount}</span>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                  </div>
                </div>
              </div>
            )}
          </PopoverTrigger>

          <PopoverContent
            side="right"
            align="end"
            className="p-0 overflow-hidden text-sm select-none"
            sideOffset={6}
            onFocusOutside={(e) => e.preventDefault}
          >
            <div className="flex flex-col">
<<<<<<< HEAD
              <div className="p-2 py-1.5 bg-main-view-fg/5 border-b border-main-view-fg/6">
                <p className="text-xs text-main-view-fg/70">
=======
              <div className="px-3 py-2 border-b">
                <p>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                  {t('downloading')}
                </p>
              </div>
              <div className="p-2 max-h-[300px] overflow-y-auto space-y-2">
                {appUpdateState.isDownloading && (
<<<<<<< HEAD
                  <div className="bg-main-view-fg/4 rounded-md p-2">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-main-view-fg/80">
=======
                  <div className="rounded-md p-2">
                    <div className="flex items-center justify-between">
                      <p className="truncate">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                        App Update
                      </p>
                    </div>
                    <Progress
                      value={appUpdateState.downloadProgress * 100}
                      className="my-2"
                    />
<<<<<<< HEAD
                    <p className="text-main-view-fg/60 text-xs">
=======
                    <p className="text-muted-foreground text-xs">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                      {`${renderGB(appUpdateState.downloadedBytes)} / ${renderGB(appUpdateState.totalBytes)}`}{' '}
                      GB ({Math.round(appUpdateState.downloadProgress * 100)}
                      %)
                    </p>
                  </div>
                )}
                {downloadProcesses.map((download) => (
                  <div
                    key={download.id}
<<<<<<< HEAD
                    className="bg-main-view-fg/4 rounded-md p-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="truncate text-main-view-fg/80">
=======
                    className="rounded-md p-2"
                  >
                    <div className="flex items-center justify-between">
                      <p className="truncate">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                        {download.name}
                      </p>
                      <div className="shrink-0 flex items-center space-x-0.5">
                        <IconX
                          size={16}
<<<<<<< HEAD
                          className="text-main-view-fg/70 cursor-pointer"
=======
                          className="text-muted-foreground cursor-pointer"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                          title="Cancel download"
                          onClick={() => {
                            // TODO: Consolidate cancellation logic
                            if (download.id.startsWith('llamacpp')) {
                              const downloadManager =
                                window.core.extensionManager.getByName(
                                  '@janhq/download-extension'
                                )

                              downloadManager.cancelDownload(download.id)
                            } else {
                              serviceHub
                                .models()
                                .abortDownload(download.name)
                                .then(() => {
                                  toast.info(
                                    t('common:toast.downloadCancelled.title'),
                                    {
                                      id: 'cancel-download',
                                      description: t(
                                        'common:toast.downloadCancelled.description'
                                      ),
                                    }
                                  )
                                  if (downloadProcesses.length === 0) {
                                    setIsPopoverOpen(false)
                                  }
                                })
                            }
                          }}
                        />
                      </div>
                    </div>
                    <Progress
                      value={download.progress * 100}
                      className="my-2"
                    />
<<<<<<< HEAD
                    <p className="text-main-view-fg/60 text-xs">
=======
                    <p className="text-muted-foreground text-xs">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                      {download.total > 0
                        ? `${renderGB(download.current)} / ${renderGB(download.total)} GB (${Math.round(download.progress * 100)}%)`
                        : 'Initializing download...'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
