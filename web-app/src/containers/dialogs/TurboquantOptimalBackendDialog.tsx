import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  IconCheck,
  IconLoader2,
  IconRefresh,
  IconRocket,
  IconX,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'

import {
  useBackendUpdater,
  type UseBackendUpdaterConfig,
} from '@/hooks/useBackendUpdater'
import { localStorageKey } from '@/constants/localStorage'
import { TURBOQUANT_OPTIMAL_PROMPT_EVENT } from '@/utils/switchModel'

const BACKEND_DETECTION_FAILED = 'BACKEND_DETECTION_FAILED'

/// Once-ever, Windows/Linux-only prompt offered after the first model start on
/// the turboquant (`llamacpp`) provider. Mounted globally in `__root.tsx`; it
/// listens for the `TURBOQUANT_OPTIMAL_PROMPT_EVENT` dispatched from
/// `switchModel.ts`. The whole flow runs through a turboquant-configured
/// `useBackendUpdater` so the recommendation/download resolves the turboquant
/// extension and its own localStorage keys (never the upstream provider's).
const TurboquantOptimalBackendDialog = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // `prompt` = initial Skip/Find choice; `working` = detection + download +
  // hot-swap in flight (driven by the hook's `recommendationPhase`).
  const [view, setView] = useState<'prompt' | 'working'>('prompt')

  const config = useMemo<UseBackendUpdaterConfig>(
    () => ({
      extensionName: '@janhq/llamacpp-extension',
      providerId: 'llamacpp',
      recommendationKey: 'turboquant_better_backend_recommendation',
      postUpgradeRecheckEnabled: false,
    }),
    []
  )

  const {
    recommendation,
    recommendationPhase,
    recheckOptimalBackend,
    downloadRecommendedBackend,
  } = useBackendUpdater(config)

  useEffect(() => {
    const handler = () => {
      // Persist the once-ever flag the moment the prompt is shown, so it never
      // reappears even if the user dismisses with Esc or reloads mid-flow.
      try {
        localStorage.setItem(localStorageKey.turboquantOptimalPromptShown, '1')
      } catch {
        // Non-fatal: worst case the prompt could show again on a later launch.
      }
      setView('prompt')
      setOpen(true)
    }
    window.addEventListener(TURBOQUANT_OPTIMAL_PROMPT_EVENT, handler)
    return () =>
      window.removeEventListener(TURBOQUANT_OPTIMAL_PROMPT_EVENT, handler)
  }, [])

  // Auto-close shortly after a successful hot-swap (the hook transiently sets
  // `completed` then returns to idle on its own).
  useEffect(() => {
    if (view === 'working' && recommendationPhase === 'completed') {
      toast.success(t('settings:backendUpdater.hotSwapSuccess'))
      const timer = setTimeout(() => setOpen(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [view, recommendationPhase, t])

  const handleSkip = useCallback(() => {
    setOpen(false)
  }, [])

  const handleFind = useCallback(async () => {
    setView('working')
    try {
      const result = await recheckOptimalBackend()
      if (!result) {
        toast.success(t('settings:backendUpdater.alreadyOptimal'))
        setOpen(false)
        return
      }
      await downloadRecommendedBackend(result.recommendedBackend)
      // After the download resolves the hot-swap runs via Tauri events; the
      // `completed`/`restart-required` phase drives the rest of the UI.
    } catch (error) {
      if (error instanceof Error && error.message === BACKEND_DETECTION_FAILED) {
        toast.info(t('settings:backendUpdater.detectionUnavailable'))
      } else {
        console.error('Turboquant optimal backend flow failed:', error)
        toast.error(t('settings:backendUpdater.downloadFailed'))
      }
      setOpen(false)
    }
  }, [recheckOptimalBackend, downloadRecommendedBackend, t])

  const handleRestart = useCallback(async () => {
    try {
      await window.core?.api?.relaunch()
    } catch (error) {
      console.error('Failed to relaunch:', error)
    }
  }, [])

  const busy =
    view === 'working' &&
    (recommendationPhase === 'recommend' ||
      recommendationPhase === 'downloading' ||
      recommendationPhase === 'hotswapping' ||
      recommendationPhase === 'completed')

  const restartRequired =
    view === 'working' && recommendationPhase === 'restart-required'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block dismissal while work is in flight; allow it on the prompt and
        // on the terminal restart-required step.
        if (!next && !busy) setOpen(false)
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        {view === 'prompt' && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('settings:turboquantOptimalPrompt.title')}
              </DialogTitle>
              <DialogDescription>
                {t('settings:turboquantOptimalPrompt.description')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleSkip}>
                <IconX size={16} className="mr-1" />
                {t('settings:turboquantOptimalPrompt.skip')}
              </Button>
              <Button onClick={handleFind}>
                <IconRocket size={16} className="mr-1" />
                {t('settings:turboquantOptimalPrompt.find')}
              </Button>
            </DialogFooter>
          </>
        )}

        {busy && (
          <>
            <DialogHeader>
              <DialogTitle>
                {recommendationPhase === 'completed'
                  ? t('settings:backendUpdater.hotSwapSuccess')
                  : recommendationPhase === 'hotswapping'
                    ? t('settings:backendUpdater.hotSwapping')
                    : t('settings:backendUpdater.downloadingBackend')}
              </DialogTitle>
              <DialogDescription>
                {recommendationPhase === 'completed'
                  ? t('settings:backendUpdater.hotSwapSuccessDesc', {
                      backend:
                        recommendation?.recommendedCategory ??
                        recommendation?.recommendedBackend ??
                        '',
                    })
                  : recommendationPhase === 'hotswapping'
                    ? t('settings:backendUpdater.hotSwappingDesc', {
                        backend:
                          recommendation?.recommendedCategory ??
                          recommendation?.recommendedBackend ??
                          '',
                      })
                    : t('settings:backendUpdater.downloadingBackendDesc')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center py-4">
              {recommendationPhase === 'completed' ? (
                <IconCheck size={32} className="text-emerald-500" />
              ) : (
                <IconLoader2 size={32} className="text-blue-500 animate-spin" />
              )}
            </div>
          </>
        )}

        {restartRequired && (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('settings:backendUpdater.restartRequired')}
              </DialogTitle>
              <DialogDescription>
                {t('settings:backendUpdater.restartRequiredDesc')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={handleRestart}>
                <IconRefresh size={16} className="mr-1" />
                {t('settings:backendUpdater.restartNow')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default TurboquantOptimalBackendDialog
