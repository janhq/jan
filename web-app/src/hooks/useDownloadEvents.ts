import { DownloadEvent, DownloadState, events } from '@janhq/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { formatBytes } from '@/lib/utils'
import { isPlatformTauri } from '@/lib/platform/utils'

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
    markFailed,
    markRetrying,
    removeDownload,
    removeLocalDownloadingModel,
  } = useDownloadStore()

  // 速度估算样本:每模型保留最近一次 (时间, 字节) 与平滑后速度。
  // 速度与下载事件耦合:只在进度事件到达时计算,事件间不猜。
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
      const prev = speedSamples.current.get(state.modelId)
      let speed = prev?.speed ?? 0

      if (bytes != null) {
        if (!prev || bytes < prev.bytes) {
          // 首个样本或重试后字节回退(从账本断点重计):重新计数,速度归零
          speed = 0
        } else if (now > prev.ts) {
          const dt = (now - prev.ts) / 1000
          if (dt >= 0.2) {
            // 指数平滑;瞬时值用真实字节差/真实时间差
            const instant = Math.max((bytes - prev.bytes) / dt, 0)
            speed = prev.speed > 0 ? prev.speed * 0.6 + instant * 0.4 : instant
          }
          // dt < 0.2s 的事件(5MB 快速通道的密集发射)沿用上次速度,防抖
        }
        speedSamples.current.set(state.modelId, { ts: now, bytes, speed })
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

  // 重试状态与真实下载事件绑定:后端在段/任务重试的退避开始时发出
  // download-retrying,这里把条目转入"重试中"(速度归零);字节恢复后
  // 进度事件自然把状态带回"进行中"。
  const onDownloadRetrying = useCallback(
    (payload: { modelId?: string; taskId?: string; attempt?: number }) => {
      const id = payload?.modelId || payload?.taskId
      if (!id) return
      // 只标记已存在的条目(避免给未知 taskId 造出幽灵条目)
      if (!useDownloadStore.getState().downloads[id]) return
      const sample = speedSamples.current.get(id)
      if (sample) sample.speed = 0
      markRetrying(id, payload?.attempt)
    },
    [markRetrying]
  )

  // 后端重试事件走 Tauri 事件通道(Rust app.emit 的标准接收端,与 core
  // 事件总线分离):段/任务重试退避开始时转入"重试中",字节恢复后进度
  // 事件自动带回"进行中"。
  useEffect(() => {
    if (!isPlatformTauri()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen<{ modelId?: string; taskId?: string; attempt?: number }>(
      'download-retrying',
      (event) => {
        onDownloadRetrying(event.payload)
      }
    )
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      .catch((e) => console.warn('listen download-retrying failed:', e))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [onDownloadRetrying])

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      resetSpeedSample(state.modelId)
      // 条目标记为失败并保留(冻结在断点),不再直接删除:下载管理弹窗里
      // 留一行原因 + [重试][移除],用户不再需要凭记忆回 Hub 重新下载。
      markFailed(
        state.modelId,
        (state as unknown as { error?: string })?.error || ''
      )
      removeLocalDownloadingModel(state.modelId)

      const err = (state as unknown as { error?: string })?.error || ''

      // 暂停/取消走的也是取消路径,其"错误"是静默的:不改状态、不弹失败
      if (/cancel/i.test(err)) return

      if (err.startsWith('DISK_SPACE_INSUFFICIENT|')) {
        const [, needed, free] = err.split('|')
        toast.error(t('common:toast.diskSpaceInsufficient.title'), {
          id: 'download-failed',
          description: t('common:toast.diskSpaceInsufficient.description', {
            needed: formatBytes(Number(needed) || 0),
            free: formatBytes(Number(free) || 0),
          }),
        })
        return
      }

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
    [markFailed, removeLocalDownloadingModel, t, navigate]
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
    // 后端重试事件:段/任务重试退避开始时发出,状态与真实下载绑定
    events.on('download-retrying', onDownloadRetrying)

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
      events.off('download-retrying', onDownloadRetrying)
    }
  }, [
    onFileDownloadUpdate,
    onFileDownloadError,
    onFileDownloadSuccess,
    onFileDownloadStopped,
    onModelValidationStarted,
    onModelValidationFailed,
    onFileDownloadAndVerificationSuccess,
    onDownloadRetrying,
  ])
}
