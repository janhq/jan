import { DownloadEvent, DownloadState, events } from '@janhq/core'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useTranslation } from '@/i18n/react-i18next-compat'

/**
 * Bridges download events into the download store.
 *
 * This must be mounted for the whole app lifetime, not alongside the download
 * popover: that popover lives in the sidebar or the header depending on layout,
 * and on the first-run setup screen neither copy is guaranteed to be mounted.
 * With no subscriber the Rust download still ran to completion while the UI
 * showed no progress and never cleared its "downloading" flag.
 */
export function useDownloadEvents() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    updateProgress,
    removeDownload,
    removeLocalDownloadingModel,
  } = useDownloadStore()

  // 速度估算样本:每模型保留最近一次 (时间, 字节) 与平滑后速度
  const speedSamples = useRef(
    new Map<string, { ts: number; bytes: number; speed: number }>()
  )
  const resetSpeedSample = (modelId: string) => {
    speedSamples.current.delete(modelId)
  }

  const onFileDownloadUpdate = useCallback(
    (state: DownloadState) => {
      const bytes = state.size?.transferred
      const now = Date.now()
      let speed: number | undefined

      if (bytes != null) {
        const prev = speedSamples.current.get(state.modelId)
        if (!prev || bytes < prev.bytes) {
          // 首个样本或新文件/重下(字节回退):重新计数,速度从 0 起步
          speedSamples.current.set(state.modelId, { ts: now, bytes, speed: 0 })
          speed = 0
        } else {
          const dt = (now - prev.ts) / 1000
          if (dt >= 0.8) {
            // 指数平滑,避免瞬时波动;卡住时速度自然衰减到 0
            const instant = (bytes - prev.bytes) / dt
            speed =
              prev.speed > 0
                ? prev.speed * 0.6 + Math.max(instant, 0) * 0.4
                : Math.max(instant, 0)
            speedSamples.current.set(state.modelId, { ts: now, bytes, speed })
          } else {
            speed = prev.speed
          }
        }
      }

      updateProgress(
        state.modelId,
        state.percent,
        state.modelId,
        state.size?.transferred,
        state.size?.total,
        speed
      )
    },
    [updateProgress]
  )

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      resetSpeedSample(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)

      const err = (state as unknown as { error?: string })?.error || ''

      if (err.includes('HTTP status 401')) {
        toast.error(t('common:toast.downloadTokenRequired.title'), {
          id: 'download-failed',
          description: t('common:toast.downloadTokenRequired.description'),
          action: {
            label: t('common:toast.openSettings'),
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      if (err.includes('HTTP status 403')) {
        toast.error(t('common:toast.downloadLicenseRequired.title'), {
          id: 'download-failed',
          description: t('common:toast.downloadLicenseRequired.description'),
        })
        return
      }

      if (err.includes('HTTP status 429')) {
        toast.error(t('common:toast.downloadRateLimited.title'), {
          id: 'download-failed',
          description: t('common:toast.downloadRateLimited.description'),
          action: {
            label: t('common:toast.openSettings'),
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
    (event: { modelId: string }) => {
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
    (event: { modelId: string }) => {
      toast.dismiss(`model-validation-started-${event.modelId}`)
      resetSpeedSample(event.modelId)
      removeDownload(event.modelId)
      removeLocalDownloadingModel(event.modelId)

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
      // A pause stops the download via the same cancel path; keep the entry
      // (with its partial progress) so it can be resumed.
      if (useDownloadStore.getState().downloads[state.modelId]?.paused) return
      resetSpeedSample(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    },
    [removeDownload, removeLocalDownloadingModel]
  )

  const onFileDownloadSuccess = useCallback(
    (state: DownloadState) => {
      toast.dismiss(`model-validation-started-${state.modelId}`)
      resetSpeedSample(state.modelId)
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
    (state: DownloadState) => {
      toast.dismiss(`model-validation-started-${state.modelId}`)
      resetSpeedSample(state.modelId)
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
      toast.success(t('common:toast.downloadAndVerificationComplete.title'), {
        id: 'download-complete',
        description: t(
          'common:toast.downloadAndVerificationComplete.description',
          { item: state.modelId }
        ),
      })
    },
    [removeDownload, removeLocalDownloadingModel, t]
  )

  useEffect(() => {
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

    return () => {
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
    }
  }, [
    onFileDownloadUpdate,
    onFileDownloadError,
    onFileDownloadSuccess,
    onFileDownloadStopped,
    onModelValidationStarted,
    onModelValidationFailed,
    onFileDownloadAndVerificationSuccess,
  ])
}
