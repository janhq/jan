import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { DownloadEvent, DownloadState, events, AppEvent } from '@janhq/core'
import { IconX, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  clearDownloadCancellationRequested,
  markDownloadCancellationRequested,
  wasDownloadCancellationRequested,
} from '@/lib/downloadCancellation'
import posthog from 'posthog-js'
import {
  classifyDownloadFailure,
  downloadKind,
  finalizeDownloadOnce,
  markModelDownloaded,
  parseHttpStatus,
  quantFromModelId,
  scrubPii,
  sizeBucket,
  takeDownloadDuration,
} from '@/lib/telemetry'
import { captureHandledError } from '@/lib/sentry'

//* Полупрозрачная зелень: текст % и ГБ остаётся читаемым в светлой и тёмной теме
const DOWNLOAD_PROGRESS_INDICATOR = 'bg-emerald-400/50 dark:bg-emerald-400/45'

function isCancellationLikeError(error?: string): boolean {
  if (!error) return false
  return /abort|aborted|cancel|cancelled|canceled|stop|stopped|interrupt/i.test(
    error
  )
}

/**
 * ATO-109: emit the terminal `model_download` event. Deduplicated so the two
 * success events don't double-count. PII contract: only ids/enums/buckets.
 */
function captureDownloadTerminal(
  status: 'completed' | 'failed' | 'cancelled',
  id: string,
  opts: { downloadType?: string; error?: string; totalBytes?: number } = {}
): void {
  if (!finalizeDownloadOnce(id)) return

  const kind = downloadKind(id, opts.downloadType)
  if (status === 'completed' && kind === 'model') {
    markModelDownloaded(id)
  }

  try {
    posthog.capture('model_download', {
      status,
      download_kind: kind,
      model_id: id,
      quant: quantFromModelId(id),
      size_bucket: sizeBucket(opts.totalBytes),
      duration_ms: takeDownloadDuration(id),
      failure_reason:
        status === 'completed'
          ? undefined
          : classifyDownloadFailure(opts.error),
      http_status: parseHttpStatus(opts.error),
    })
  } catch (telemetryError) {
    console.debug('model_download terminal telemetry failed:', telemetryError)
  }
}

export function DownloadManagement() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const prevDownloadCount = useRef(0)
  const autoHidePopoverTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const serviceHub = useServiceHub()
  const {
    downloads,
    updateProgress,
    localDownloadingModels,
    removeDownload,
    removeLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
    pausedDownloads,
    markPausedDownload,
    clearPausedDownload,
    resumeParams,
    clearResumeParams,
    clearDownloadOrigin,
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

  useEffect(() => {
    const prev = prevDownloadCount.current
    prevDownloadCount.current = downloadCount
    if (downloadCount > 0 && prev === 0) {
      setIsPopoverOpen(true)
      if (autoHidePopoverTimer.current) {
        clearTimeout(autoHidePopoverTimer.current)
      }
      autoHidePopoverTimer.current = setTimeout(() => {
        setIsPopoverOpen(false)
        autoHidePopoverTimer.current = null
      }, 3500)
    } else if (downloadCount === 0 && prev > 0) {
      if (autoHidePopoverTimer.current) {
        clearTimeout(autoHidePopoverTimer.current)
        autoHidePopoverTimer.current = null
      }
      setIsPopoverOpen(false)
    }
  }, [downloadCount])

  useEffect(() => {
    return () => {
      if (autoHidePopoverTimer.current) {
        clearTimeout(autoHidePopoverTimer.current)
      }
    }
  }, [])

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
      clearPausedDownload(state.modelId)
      clearResumeParams(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      clearDownloadOrigin(state.modelId)

      const anyState = state as unknown as {
        error?: string
        downloadType?: string
      }
      const err = anyState?.error || ''

      const cancelled =
        wasDownloadCancellationRequested(state.modelId) ||
        isCancellationLikeError(err)
      captureDownloadTerminal(cancelled ? 'cancelled' : 'failed', state.modelId, {
        downloadType: anyState?.downloadType,
        error: err,
        totalBytes: state.size?.total,
      })

      if (cancelled) {
        markResumableDownload(state.modelId)
        toast.dismiss('download-failed')
        return
      }

      // ATO-113: report genuine download failures to Sentry with zero-PII tags
      // (classification enums + http status only; the raw error string carries
      // URLs/tokens and is scrubbed by beforeSend before leaving the device).
      captureHandledError(
        anyState?.error ? new Error(scrubPii(err)) : 'model_download failed',
        'error',
        {
          feature: 'model_download',
          failure_reason: classifyDownloadFailure(err),
          http_status: parseHttpStatus(err),
          download_kind: downloadKind(state.modelId, anyState?.downloadType),
          model_id: state.modelId,
          quant: quantFromModelId(state.modelId),
        }
      )

      if (err.includes('HTTP status 401')) {
        clearResumableDownload(state.modelId)
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
        clearResumableDownload(state.modelId)
        toast.error('Accept model license on Hugging Face', {
          id: 'download-failed',
          description:
            'You must accept the model’s license on its Hugging Face page before downloading.',
        })
        return
      }

      if (err.includes('HTTP status 429')) {
        markResumableDownload(state.modelId)
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

      markResumableDownload(state.modelId)
      toast.error(t('common:toast.downloadFailed.title'), {
        id: 'download-failed',
        description: t('common:toast.downloadFailed.description', {
          item: state.modelId,
        }),
      })
    },
    [
      removeDownload,
      removeLocalDownloadingModel,
      markResumableDownload,
      clearResumableDownload,
      clearPausedDownload,
      clearResumeParams,
      clearDownloadOrigin,
      t,
      navigate,
    ]
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

      captureDownloadTerminal('failed', event.modelId, {
        downloadType: 'Model',
        error: event.error || event.reason,
      })

      clearResumableDownload(event.modelId)
      clearPausedDownload(event.modelId)
      clearResumeParams(event.modelId)
      removeDownload(event.modelId)
      removeLocalDownloadingModel(event.modelId)
      clearDownloadOrigin(event.modelId)

      // Show specific toast for validation failure
      toast.error(t('common:toast.modelValidationFailed.title'), {
        description: t('common:toast.modelValidationFailed.description', {
          modelId: event.modelId,
        }),
        duration: 30000,
      })
    },
    [
      removeDownload,
      removeLocalDownloadingModel,
      clearResumableDownload,
      clearPausedDownload,
      clearResumeParams,
      clearDownloadOrigin,
      t,
    ]
  )

  const onFileDownloadStopped = useCallback(
    (state: DownloadState) => {
      console.debug('onFileDownloadStopped', state)

      // ATO-154: a paused download stops the transfer but is not a terminal
      // event. Keep the `downloads[modelId]` entry (so the popover row survives
      // with its last progress + a Resume button) and skip the cancelled
      // telemetry/toast/cleanup. The partial file is kept on disk by the Rust
      // downloader, so resume continues from where it stopped. Read paused
      // state from the store directly (not the closure) so the async stop
      // event can't race a stale render of `pausedDownloads`.
      if (useDownloadStore.getState().pausedDownloads.has(state.modelId)) {
        markResumableDownload(state.modelId)
        return
      }

      captureDownloadTerminal('cancelled', state.modelId, {
        downloadType: (state as unknown as { downloadType?: string })
          ?.downloadType,
        totalBytes: state.size?.total,
      })
      clearPausedDownload(state.modelId)
      clearResumeParams(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      clearDownloadOrigin(state.modelId)
      toast.dismiss('download-failed')

      markResumableDownload(state.modelId)
      if (wasDownloadCancellationRequested(state.modelId)) {
        toast.info(t('common:toast.downloadCancelled.title'), {
          id: 'cancel-download',
          description: t('common:toast.downloadCancelled.description'),
        })
        clearDownloadCancellationRequested(state.modelId)
      }
    },
    [
      removeDownload,
      removeLocalDownloadingModel,
      markResumableDownload,
      clearPausedDownload,
      clearResumeParams,
      clearDownloadOrigin,
      t,
    ]
  )

  const onFileDownloadSuccess = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadSuccess', state)

      captureDownloadTerminal('completed', state.modelId, {
        downloadType: (state as unknown as { downloadType?: string })
          ?.downloadType,
        totalBytes: state.size?.total,
      })

      // Dismiss any validation started toast when download completes successfully
      toast.dismiss(`model-validation-started-${state.modelId}`)

      clearDownloadCancellationRequested(state.modelId)
      clearResumableDownload(state.modelId)
      clearPausedDownload(state.modelId)
      clearResumeParams(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      clearDownloadOrigin(state.modelId)
      toast.success(t('common:toast.downloadComplete.title'), {
        id: 'download-complete',
        description: t('common:toast.downloadComplete.description', {
          item: state.modelId,
        }),
      })
    },
    [
      removeDownload,
      removeLocalDownloadingModel,
      clearResumableDownload,
      clearPausedDownload,
      clearResumeParams,
      clearDownloadOrigin,
      t,
    ]
  )

  const onFileDownloadAndVerificationSuccess = useCallback(
    async (state: DownloadState) => {
      console.debug('onFileDownloadAndVerificationSuccess', state)

      captureDownloadTerminal('completed', state.modelId, {
        downloadType: (state as unknown as { downloadType?: string })
          ?.downloadType,
        totalBytes: state.size?.total,
      })

      // Dismiss any validation started toast when download and verification complete successfully
      toast.dismiss(`model-validation-started-${state.modelId}`)

      clearDownloadCancellationRequested(state.modelId)
      clearResumableDownload(state.modelId)
      clearPausedDownload(state.modelId)
      clearResumeParams(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      clearDownloadOrigin(state.modelId)
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
    [
      removeDownload,
      removeLocalDownloadingModel,
      clearResumableDownload,
      clearPausedDownload,
      clearResumeParams,
      clearDownloadOrigin,
      t,
    ]
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

  // ATO-154: pause/resume is only offered for resumable model (GGUF) downloads.
  // Backend-binary downloads (`llamacpp*`) and MLX repos (`mlx-community/*`,
  // which start with `mlx`) get cancel-only, matching Jan's gating.
  const isPausableDownload = (id: string): boolean =>
    !id.startsWith('llamacpp') && !id.startsWith('mlx')

  const handlePauseDownload = useCallback(
    (download: { id: string; name: string }) => {
      markPausedDownload(download.id)
      markResumableDownload(download.id)
      if (download.id !== download.name) {
        markPausedDownload(download.name)
        markResumableDownload(download.name)
      }
      void serviceHub.models().abortDownload(download.name)
    },
    [markPausedDownload, markResumableDownload, serviceHub]
  )

  const handleResumeDownload = useCallback(
    (download: { id: string; name: string }) => {
      const params = resumeParams[download.id] ?? resumeParams[download.name]
      if (!params) {
        // No stored params (e.g. resumed after an app restart). Fall back to
        // cancel-style cleanup so the row doesn't get stuck in a paused state.
        clearPausedDownload(download.id)
        toast.error(t('common:toast.downloadFailed.title'), {
          description: t('common:toast.downloadFailed.description', {
            item: download.name,
          }),
        })
        return
      }
      clearPausedDownload(download.id)
      if (download.id !== download.name) clearPausedDownload(download.name)
      markResumableDownload(download.id)
      void serviceHub
        .models()
        .pullModelWithMetadata(
          download.id,
          params.modelPath,
          params.mmprojPath,
          params.hfToken,
          params.skipVerification ?? true,
          true
        )
        .catch((error) => {
          console.error('[DownloadManagement] resume failed:', error)
        })
    },
    [
      resumeParams,
      clearPausedDownload,
      markResumableDownload,
      serviceHub,
      t,
    ]
  )

  return (
    <>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground z-50 rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 size-7 relative"
          >
            <DownloadIcon className="text-muted-foreground size-4" />
            {downloadCount > 0 && (
              <svg
                className="absolute inset-0 size-7 -rotate-90"
                viewBox="0 0 36 36"
              >
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
          onOpenAutoFocus={(e) => e.preventDefault()}
          onFocusOutside={(e) => {
            if (downloadCount > 0) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (downloadCount > 0) e.preventDefault()
          }}
        >
          <div className="flex flex-col">
            {appUpdateState.isDownloading || downloadProcesses.length > 0 ? (
              <>
                <div className="px-3 pt-2 flex items-center justify-between">
                  <p>{t('downloading')}</p>
                </div>
                <div className="p-2 max-h-[300px] overflow-y-auto space-y-2">
                  {appUpdateState.isDownloading && (
                    <div className="rounded-lg p-2 bg-secondary">
                      <div className="flex items-center justify-between">
                        <p className="truncate">App Update</p>
                      </div>
                      <div className="relative z-40 my-2 h-6">
                        <Progress
                          value={appUpdateState.downloadProgress * 100}
                          indicatorClassName={DOWNLOAD_PROGRESS_INDICATOR}
                          className="absolute inset-0 h-full bg-muted-foreground/15 dark:bg-muted-foreground/20 rounded-md"
                        />
                        <div className="pointer-events-none absolute inset-0 z-1 flex items-center justify-between px-2">
                          <p className="text-xs font-medium tabular-nums text-foreground">
                            {Math.round(appUpdateState.downloadProgress * 100)}%
                          </p>
                          <p className="text-xs font-medium tabular-nums text-foreground">
                            {`${renderGB(appUpdateState.downloadedBytes)} / ${renderGB(appUpdateState.totalBytes)}`}{' '}
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
                        <p className="truncate">{download.name}</p>
                        <div className="shrink-0 flex items-center space-x-0.5">
                          {isPausableDownload(download.id) &&
                            (pausedDownloads.has(download.id) ? (
                              <Button
                                variant="secondary"
                                size="icon-xs"
                                onClick={() => handleResumeDownload(download)}
                              >
                                <IconPlayerPlay
                                  size={16}
                                  className="text-muted-foreground cursor-pointer"
                                  title={t('resumeDownload')}
                                />
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="icon-xs"
                                onClick={() => handlePauseDownload(download)}
                              >
                                <IconPlayerPause
                                  size={16}
                                  className="text-muted-foreground cursor-pointer"
                                  title={t('pauseDownload')}
                                />
                              </Button>
                            ))}
                          <Button
                            variant="secondary"
                            size="icon-xs"
                            onClick={() => {
                              markDownloadCancellationRequested(download.name)
                              markResumableDownload(download.name)
                              clearPausedDownload(download.name)
                              clearResumeParams(download.name)
                              if (download.id !== download.name) {
                                markDownloadCancellationRequested(download.id)
                                markResumableDownload(download.id)
                                clearPausedDownload(download.id)
                                clearResumeParams(download.id)
                              }
                              if (
                                download.id.startsWith('llamacpp') ||
                                download.id.startsWith('mlx')
                              ) {
                                const downloadManager =
                                  window.core.extensionManager.getByName(
                                    '@janhq/download-extension'
                                  )
                                downloadManager.cancelDownload(download.id)
                              } else {
                                serviceHub.models().abortDownload(download.name)
                                if (downloadProcesses.length === 0) {
                                  setIsPopoverOpen(false)
                                }
                              }
                              setIsPopoverOpen(false)
                            }}
                          >
                            <IconX
                              size={16}
                              className="text-muted-foreground cursor-pointer"
                              title={t('cancelDownload')}
                            />
                          </Button>
                        </div>
                      </div>
                      <div className="relative z-40 my-2 h-6">
                        <Progress
                          value={download.progress * 100}
                          indicatorClassName={DOWNLOAD_PROGRESS_INDICATOR}
                          className="absolute inset-0 h-full bg-muted-foreground/15 dark:bg-muted-foreground/20 rounded-md"
                        />
                        <div className="pointer-events-none absolute inset-0 z-1 flex items-center justify-between px-2">
                          <p className="text-xs font-medium tabular-nums text-foreground">
                            {download.total > 0
                              ? `${Math.round(download.progress * 100)}%`
                              : 'Initializing download...'}
                          </p>
                          <p className="text-xs font-medium tabular-nums text-foreground">
                            {download.total > 0
                              ? `${renderGB(download.current)} / ${renderGB(download.total)} GB`
                              : ''}
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
