import { useCallback, useEffect, useRef, useState } from 'react'

import {
  IconCpu,
  IconDownload,
  IconLoader2,
  IconRefresh,
  IconRocket,
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import { ExtensionManager } from '@/lib/extension'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useBackendUpdater } from '@/hooks/useBackendUpdater'
import { cn } from '@/lib/utils'

/// Mirrors the public `recheckOptimalBackend()` method on
/// `extensions/llamacpp-extension/src/index.ts`. We only depend on the public
/// shape of the return value here.
type LlamacppLikeExtension = {
  recheckOptimalBackend?: () => Promise<{
    currentBackend: string
    recommendedBackend: string
    recommendedCategory: string
  } | null>
}

/// Local UI phases for the onboarding step. We intentionally do NOT couple
/// this 1:1 with `RecommendationPhase` from `useBackendUpdater` because the
/// onboarding flow has additional terminal states (no GPU available; manual
/// "Skip" before any download started) that don't fit the dialog state
/// machine the post-onboarding flow uses.
type StepUiPhase =
  | 'detecting'
  | 'recommend'
  | 'downloading'
  | 'switching'
  | 'restart-required'
  | 'no-recommendation'
  | 'detection-failed'

interface SetupBackendStepProps {
  /// Called when the user has either skipped, downloaded the recommended
  /// backend, or no recommendation applies for the current device. The
  /// parent advances to the next onboarding step (model selection).
  onDone: (status: 'downloaded' | 'skipped') => void
}

function getLlamacppExtension(): LlamacppLikeExtension | null {
  const direct = ExtensionManager.getInstance().getByName('llamacpp-extension')
  if (direct) {
    return direct as unknown as LlamacppLikeExtension
  }
  // Fallback path mirrors `useBackendUpdater` — extensions are registered
  // by class name in some builds (notably the bundled-from-tarball flow).
  const all = ExtensionManager.getInstance().listExtensions()
  const candidate = all.find(
    (ext) =>
      ext.constructor.name.toLowerCase().includes('llamacpp') ||
      (ext.type && ext.type()?.toString().toLowerCase().includes('inference'))
  )
  return (candidate as unknown as LlamacppLikeExtension) ?? null
}

export default function SetupBackendStep({ onDone }: SetupBackendStepProps) {
  const { t } = useTranslation()
  const {
    recommendation,
    recommendationPhase,
    downloadState,
    downloadRecommendedBackend,
  } = useBackendUpdater()

  const [uiPhase, setUiPhase] = useState<StepUiPhase>('detecting')
  /// Guards against double-firing `onDone` (e.g. if both a network call and
  /// a manual click resolve at the same tick).
  const finishedRef = useRef(false)
  /// Tracks whether the user explicitly chose to download — needed because
  /// `recommendationPhase` resets to 'recommend' on download failure, and we
  /// don't want to silently regress the UI.
  const downloadAttemptedRef = useRef(false)

  const finish = useCallback(
    (status: 'downloaded' | 'skipped') => {
      if (finishedRef.current) return
      finishedRef.current = true
      // Drop any persisted recommendation so the post-onboarding
      // BackendUpdater (mounted only after setupCompleted) does not
      // restore a stale dialog on the next mount. The Download path
      // already clears this key inside the extension; the Skip path
      // explicitly drops it here.
      if (status === 'skipped') {
        try {
          localStorage.removeItem('llama_cpp_better_backend_recommendation')
        } catch {
          // localStorage may be unavailable (very rare on Tauri WebView2);
          // ignore — worst case the dialog reappears once post-onboarding,
          // which the user can dismiss.
        }
      }
      onDone(status)
    },
    [onDone]
  )

  // Trigger detection on mount. We rely on `recheckOptimalBackend()` to:
  //  - run hardware detection,
  //  - emit `onBetterBackendDetected` so `useBackendUpdater` populates
  //    `recommendation` synchronously via its mounted listener,
  //  - return null when there's nothing to upgrade (hardware can't do
  //    better than CPU, or detection failed silently).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const ext = getLlamacppExtension()
        if (!ext?.recheckOptimalBackend) {
          if (!cancelled) setUiPhase('detection-failed')
          return
        }
        const result = await ext.recheckOptimalBackend()
        if (cancelled) return
        if (!result) {
          setUiPhase('no-recommendation')
        } else {
          setUiPhase('recommend')
        }
      } catch (err) {
        console.warn('[SetupBackendStep] detection failed', err)
        if (!cancelled) setUiPhase('detection-failed')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  // Translate `useBackendUpdater` state changes into our local UI phase.
  // Once we've started a download we follow the hook's machine through
  // 'downloading' → 'hotswapping' → 'completed' (hot-swap path) or
  // 'downloading' → 'restart-required' (fallback path), or back to
  // 'recommend' on failure.
  useEffect(() => {
    if (!downloadAttemptedRef.current) return
    if (recommendationPhase === 'downloading') {
      setUiPhase('downloading')
    } else if (recommendationPhase === 'hotswapping') {
      setUiPhase('switching')
    } else if (recommendationPhase === 'completed') {
      // Hot-swap succeeded — leave onboarding without a restart.
      // `finish` is idempotent via `finishedRef`.
      finish('downloaded')
    } else if (recommendationPhase === 'restart-required') {
      setUiPhase('restart-required')
    } else if (recommendationPhase === 'recommend') {
      // Either nothing happened yet or the download failed.
      // Surface the recommendation again so the user can retry / skip.
      setUiPhase('recommend')
    }
  }, [recommendationPhase, finish])

  // Auto-advance when the device has nothing to gain — keeps onboarding
  // short for users on CPU-only machines.
  useEffect(() => {
    if (uiPhase === 'no-recommendation' || uiPhase === 'detection-failed') {
      finish('skipped')
    }
  }, [uiPhase, finish])

  const handleDownload = useCallback(async () => {
    if (!recommendation) return
    downloadAttemptedRef.current = true
    setUiPhase('downloading')
    try {
      await downloadRecommendedBackend()
    } catch (err) {
      console.error('[SetupBackendStep] download failed', err)
      // The hook itself flips back to 'recommend' on failure; the effect
      // above will sync our UI phase. Reset the attempt guard so the user
      // can retry without ambiguity.
      downloadAttemptedRef.current = false
      setUiPhase('recommend')
    }
  }, [downloadRecommendedBackend, recommendation])

  const handleRestartLater = useCallback(() => {
    finish('downloaded')
  }, [finish])

  const handleSkip = useCallback(() => {
    finish('skipped')
  }, [finish])

  const handleRestartNow = useCallback(async () => {
    try {
      await window.core?.api?.relaunch()
    } catch (err) {
      console.error('[SetupBackendStep] relaunch failed', err)
      // If the relaunch IPC blew up there's not much we can do — just
      // continue to the model step so the user isn't trapped here.
      finish('downloaded')
    }
  }, [finish])

  return (
    <div className="relative flex h-svh w-full flex-col overflow-hidden">
      <div className="flex h-svh min-h-0 w-full flex-col">
        <HeaderPage />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="pointer-events-auto mx-auto my-auto flex w-full max-w-[640px] flex-col px-6 py-8 sm:px-10 sm:py-10">
            <div className="mb-5 shrink-0 text-center">
              <div className="mb-5 flex items-center justify-center gap-3 font-studio text-4xl font-semibold leading-none tracking-tight sm:text-5xl">
                <div className="flex h-[1em] w-[1em] shrink-0 items-center justify-center rounded-lg bg-neutral-950 p-[3px] shadow-sm dark:bg-white dark:shadow-none">
                  <img
                    src="/images/transparent-logo.png"
                    alt=""
                    className="size-full min-h-0 min-w-0 object-contain invert dark:invert-0"
                    draggable={false}
                  />
                </div>
                <span>Atomic Chat</span>
              </div>
              <div className="mb-2 min-w-0">
                <span className="inline-block text-lg font-bold leading-snug sm:text-xl md:text-2xl">
                  {t('setup:backendStep.title')}
                </span>
              </div>
              <p className="text-muted-foreground mx-auto max-w-full text-sm leading-relaxed sm:text-base">
                {t('setup:backendStep.description')}
              </p>
            </div>

            <div
              className={cn(
                'w-full shrink-0 rounded-lg border bg-secondary/50 p-5 sm:p-6'
              )}
            >
              {uiPhase === 'detecting' && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <IconLoader2
                    size={28}
                    className="animate-spin text-muted-foreground"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('setup:backendStep.detecting')}
                  </p>
                </div>
              )}

              {uiPhase === 'recommend' && recommendation && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <IconRocket
                      size={28}
                      className="mt-0.5 shrink-0 text-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold leading-tight sm:text-lg">
                        {t('setup:backendStep.recommendTitle', {
                          backend: recommendation.recommendedCategory,
                        })}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('setup:backendStep.recommendDesc')}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      onClick={handleSkip}
                      className="order-2 w-full sm:order-1"
                    >
                      <IconCpu size={16} className="mr-1" />
                      {t('setup:backendStep.stayOnCpu')}
                    </Button>
                    <Button
                      onClick={handleDownload}
                      className="order-1 w-full sm:order-2"
                    >
                      <IconDownload size={16} className="mr-1" />
                      {t('setup:backendStep.downloadAction')}
                    </Button>
                  </div>
                </div>
              )}

              {uiPhase === 'downloading' && (
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <IconLoader2
                    size={28}
                    className="animate-spin text-foreground"
                  />
                  <h2 className="text-base font-semibold leading-tight">
                    {t('setup:backendStep.downloadingTitle')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('setup:backendStep.downloadingDesc', {
                      backend:
                        recommendation?.recommendedCategory ??
                        downloadState.backendName ??
                        '',
                    })}
                  </p>
                </div>
              )}

              {uiPhase === 'switching' && (
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <IconLoader2
                    size={28}
                    className="animate-spin text-foreground"
                  />
                  <h2 className="text-base font-semibold leading-tight">
                    {t('setup:backendStep.switchingTitle')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('setup:backendStep.switchingDesc', {
                      backend:
                        recommendation?.recommendedCategory ??
                        downloadState.backendName ??
                        '',
                    })}
                  </p>
                </div>
              )}

              {uiPhase === 'restart-required' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <IconRefresh
                      size={28}
                      className="mt-0.5 shrink-0 text-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold leading-tight sm:text-lg">
                        {t('setup:backendStep.restartTitle')}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('setup:backendStep.restartDesc')}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      onClick={handleRestartLater}
                      className="order-2 w-full sm:order-1"
                    >
                      {t('setup:backendStep.restartLater')}
                    </Button>
                    <Button
                      onClick={handleRestartNow}
                      className="order-1 w-full sm:order-2"
                    >
                      <IconRefresh size={16} className="mr-1" />
                      {t('setup:backendStep.restartNow')}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {uiPhase === 'recommend' && (
              <div className="relative z-60 flex shrink-0 flex-col items-center pt-4">
                <Button
                  type="button"
                  variant="link"
                  onClick={handleSkip}
                  className="text-muted-foreground/60 hover:text-muted-foreground relative z-60 h-auto p-0 text-xs font-normal underline-offset-4"
                >
                  {t('setup:skip')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
