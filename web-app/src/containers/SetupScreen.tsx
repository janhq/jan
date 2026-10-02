import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey, CACHE_EXPIRY_MS } from '@/constants/localStorage'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { AppEvent, events } from '@janhq/core'
import { SETUP_SCREEN_QUANTIZATIONS } from '@/constants/models'
import { useLatestJanModel } from '@/hooks/useLatestJanModel'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconCpu,
  IconEye,
  IconLoader2,
  IconSquareCheck,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useAnalytic } from '@/hooks/useAnalytic'
import {
  useSetupChecklist,
  type SetupStageState,
} from '@/hooks/useSetupChecklist'
import { pickMmproj, type SetupModelOption } from '@/lib/setupModelOptions'
import { AnalyticConsent } from './analytics/AnalyticConsent'
import { DependencyAdvice } from './dialogs/DependencyAdvice'
import HeaderPage from './HeaderPage'

/**
 * One page of the setup flow. The model page is derived from download state
 * rather than from a readiness probe, so it does not come from
 * `useSetupChecklist` with the others.
 */
type WizardStep = {
  id: string
  labelKey: string
  status: SetupStageState['status']
  messageKey: string
  values?: Record<string, string | number>
  detail?: string
}

/**
 * Renders before the model metadata lands, so the name and size are optional and
 * the card does not pop into existence once the fetch resolves.
 */
function ModelCard({
  option,
  fallbackName,
  progress,
  isDownloading,
  isDownloaded,
  onDownload,
}: {
  option: SetupModelOption | null
  fallbackName?: string
  /** Completed fraction, 0 to 1. */
  progress: number
  isDownloading: boolean
  isDownloaded: boolean
  onDownload: () => void
}) {
  const { t } = useTranslation()
  const name =
    option?.displayName || fallbackName || t('setup:fallbackModelName')

  return (
    <div
      data-testid="setup-model-card"
      className="bg-secondary/50 p-3 rounded-lg border flex items-center gap-3"
    >
      <div className="shrink-0 size-12 bg-background rounded-xl flex items-center justify-center">
        <img src="/images/jan-logo.png" alt="Jan Logo" className="size-6" />
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-sm truncate">
          <span>{name}</span>
          {option?.fileSize && (
            <>
              &nbsp;
              <span className="text-xs text-muted-foreground font-normal">
                · {option.fileSize}
              </span>
            </>
          )}
        </h2>
        <div className="text-muted-foreground text-sm mt-1.5 flex items-center gap-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary text-xs rounded-full">
            <IconSquareCheck size={12} />
            {t('setup:capabilityGeneral')}
          </span>
          {option?.multimodal && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary text-xs rounded-full">
              <IconEye size={12} />
              {t('setup:capabilityMultimodal')}
            </span>
          )}
        </div>
      </div>

      {/* The action sits with the thing it acts on rather than anchoring the
          screen, since downloading this model is not a precondition for the
          checks above it. */}
      <div className="shrink-0">
        {isDownloaded ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-500">
            <IconCheck size={14} />
            {t('setup:modelInstalled')}
          </span>
        ) : isDownloading ? (
          <div className="flex w-20 items-center gap-2">
            <Progress className="border" value={progress * 100} />
            <span className="text-xs text-muted-foreground">
              {Math.round(progress * 100)}%
            </span>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={onDownload}>
            {t('setup:download')}
          </Button>
        )}
      </div>
    </div>
  )
}

type CacheEntry = {
  status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY'
  timestamp: number
}

const modelSupportCache = new Map<string, CacheEntry>()

function loadCacheFromStorage() {
  try {
    const stored = localStorage.getItem(localStorageKey.modelSupportCache)
    if (stored) {
      const parsed = JSON.parse(stored)
      Object.entries(parsed).forEach(([key, value]) => {
        modelSupportCache.set(key, value as CacheEntry)
      })
    }
  } catch (error) {
    console.error('Failed to load model support cache:', error)
  }
}

function saveCacheToStorage() {
  try {
    const cacheObj = Object.fromEntries(modelSupportCache.entries())
    localStorage.setItem(
      localStorageKey.modelSupportCache,
      JSON.stringify(cacheObj)
    )
  } catch (error) {
    console.error('Failed to save model support cache:', error)
  }
}

function getCachedSupport(
  modelId: string
): 'RED' | 'YELLOW' | 'GREEN' | 'GREY' | null {
  const entry = modelSupportCache.get(modelId)
  if (!entry) return null

  const now = Date.now()
  if (now - entry.timestamp > CACHE_EXPIRY_MS) {
    modelSupportCache.delete(modelId)
    return null
  }

  return entry.status
}

function setCachedSupport(
  modelId: string,
  status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY'
) {
  modelSupportCache.set(modelId, {
    status,
    timestamp: Date.now(),
  })
  saveCacheToStorage()
}

loadCacheFromStorage()

function SetupScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getProviderByName, selectModelProvider, setProviders } =
    useModelProvider()

  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const serviceHub = useServiceHub()
  const llamaProvider = getProviderByName('llamacpp')
  const [quickStartInitiated, setQuickStartInitiated] = useState(false)
  const [quickStartQueued, setQuickStartQueued] = useState(false)
  const {
    model: janNewModel,
    error: metadataFetchFailed,
    fetchLatestJanModel,
  } = useLatestJanModel()
  const [supportedVariants, setSupportedVariants] = useState<
    Map<string, 'RED' | 'YELLOW' | 'GREEN' | 'GREY'>
  >(new Map())
  const supportCheckInProgress = useRef(false)
  const checkedModelId = useRef<string | null>(null)
  const [isSupportCheckComplete, setIsSupportCheckComplete] = useState(false)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  // Nothing is probed until the user starts: the first page is an invitation,
  // not a progress report.
  const [hasStarted, setHasStarted] = useState(false)
  const beginSetup = useCallback(() => {
    setHasStarted(true)
    // Not awaited: the readiness checks are what report its progress.
    void serviceHub.models().startEngineSetup()
  }, [serviceHub])
  const { stages, warnings, gpu, isRunning, rerun } = useSetupChecklist({
    enabled: hasStarted,
  })
  const [showDetails, setShowDetails] = useState(false)
  const { productAnalyticPrompt } = useAnalytic()
  // `productAnalyticPrompt` flips to false the moment consent is answered, which
  // dropped that page out of the list and renumbered the flow under the user
  // ("Step 3 of 4" became "Step 3 of 3"). Latched instead, so the page count is
  // fixed once known.
  const [includesConsent, setIncludesConsent] = useState(false)
  useEffect(() => {
    if (productAnalyticPrompt) setIncludesConsent(true)
  }, [productAnalyticPrompt])


  // Check model support for variants when janNewModel is available
  useEffect(() => {
    const checkModelSupport = async () => {
      if (!janNewModel) return

      if (
        supportCheckInProgress.current ||
        checkedModelId.current === janNewModel.model_name
      ) {
        return
      }

      supportCheckInProgress.current = true
      checkedModelId.current = janNewModel.model_name
      setIsSupportCheckComplete(false)

      const variantSupportMap = new Map<
        string,
        'RED' | 'YELLOW' | 'GREEN' | 'GREY'
      >()

      for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
        const variant = janNewModel.quants?.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant) {
          const cached = getCachedSupport(variant.model_id)
          if (cached) {
            console.log(`[SetupScreen] ${variant.model_id}: ${cached} (cached)`)
            variantSupportMap.set(variant.model_id, cached)
            continue
          }

          try {
            console.log(
              `[SetupScreen] Checking support for ${variant.model_id}...`
            )
            const supportStatus = await serviceHub
              .models()
              .isModelSupported(variant.path)

            console.log(`[SetupScreen] ${variant.model_id}: ${supportStatus}`)
            setCachedSupport(variant.model_id, supportStatus)
            variantSupportMap.set(variant.model_id, supportStatus)
          } catch (error) {
            console.error(
              `[SetupScreen] Error checking support for ${variant.model_id}:`,
              error
            )
            variantSupportMap.set(variant.model_id, 'GREY')
            setCachedSupport(variant.model_id, 'GREY')
          }
        }
      }

      setSupportedVariants(variantSupportMap)
      supportCheckInProgress.current = false
      setIsSupportCheckComplete(true)
    }

    checkModelSupport()
  }, [janNewModel, serviceHub])

  useEffect(() => {
    fetchLatestJanModel(true)
  }, [fetchLatestJanModel])


  const defaultVariant = useMemo(() => {
    if (!janNewModel) return null

    const priorityOrder: Array<'GREEN' | 'YELLOW' | 'GREY'> = [
      'GREEN',
      'YELLOW',
      'GREY',
    ]

    for (const status of priorityOrder) {
      for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
        const variant = janNewModel.quants?.find((quant) =>
          quant.model_id.toLowerCase().includes(quantization)
        )

        if (variant && supportedVariants.get(variant.model_id) === status) {
          return variant
        }
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janNewModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )

      if (variant && supportedVariants.get(variant.model_id) === 'RED') {
        return variant
      }
    }

    for (const quantization of SETUP_SCREEN_QUANTIZATIONS) {
      const variant = janNewModel.quants?.find((quant) =>
        quant.model_id.toLowerCase().includes(quantization)
      )
      if (variant) return variant
    }

    return janNewModel.quants?.[0]
  }, [janNewModel, supportedVariants])

  // The recommended model as a uniform option, so the download path stays
  // independent of how the quant was chosen.
  const selected = useMemo<SetupModelOption | null>(() => {
    if (!janNewModel || !defaultVariant) return null
    return {
      modelName: janNewModel.model_name,
      displayName:
        janNewModel.display_name?.trim() || janNewModel.model_name || '',
      modelId: defaultVariant.model_id,
      path: defaultVariant.path,
      fileSize: defaultVariant.file_size,
      multimodal: (janNewModel.mmproj_models?.length ?? 0) > 0,
      mmprojPath: pickMmproj(janNewModel),
    }
  }, [janNewModel, defaultVariant])

  // The quant depends on the per-variant fit check, so a click before it lands
  // has to be queued rather than acted on.
  const isSelectionReady = Boolean(selected && isSupportCheckComplete)

  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  const isDownloading = useMemo(() => {
    if (!selected) return false
    return (
      localDownloadingModels.has(selected.modelId) ||
      downloadProcesses.some((e) => e.id === selected.modelId)
    )
  }, [selected, localDownloadingModels, downloadProcesses])

  // Fraction rather than byte counts, matching how the Hub reports a download.
  const downloadProgress = useMemo(() => {
    if (!selected) return 0
    return (
      downloadProcesses.find((e) => e.id === selected.modelId)?.progress || 0
    )
  }, [selected, downloadProcesses])

  const isDownloaded = useMemo(() => {
    if (!selected) return false
    return llamaProvider?.models.some(
      (m: { id: string }) => m.id === selected.modelId
    )
  }, [selected, llamaProvider])

  // Single download entry point for both the immediate and the queued path, so
  // the HF token and the skip-verification flag cannot drift between them.
  const startDownload = useCallback(
    (option: SetupModelOption) => {
      addLocalDownloadingModel(option.modelId)
      serviceHub
        .models()
        .pullModelWithMetadata(
          option.modelId,
          option.path,
          option.mmprojPath,
          huggingfaceToken,
          true
        )
    },
    [addLocalDownloadingModel, serviceHub, huggingfaceToken]
  )

  const handleQuickStart = useCallback(() => {
    setQuickStartInitiated(true)
    // Metadata still loading: remember the intent and download once it lands.
    if (!selected || !isSelectionReady) {
      setQuickStartQueued(true)
      return
    }
    startDownload(selected)
  }, [selected, isSelectionReady, startDownload])

  // Use ref to track if we've already navigated
  const hasNavigatedRef = useRef(false)
  /** Pages the user has passed despite a warning; they must not reappear. */
  const [acknowledged, setAcknowledged] = useState<string[]>([])

  const completeSetup = useCallback(async () => {
    if (!selected || hasNavigatedRef.current) return
    hasNavigatedRef.current = true

    // Refresh providers so the model is available in the store before selecting
    const providers = await serviceHub.providers().getProviders()
    setProviders(providers)

    // On Windows the provider may list model IDs with backslashes (from filesystem paths)
    // while the catalog uses forward slashes, so try both formats
    const catalogId = selected.modelId
    const backslashId = catalogId.replace(/\//g, '\\')
    const found =
      selectModelProvider('llamacpp', catalogId) ||
      selectModelProvider('llamacpp', backslashId)
    const modelId = found ? found.id : catalogId

    toast.dismiss(`model-validation-started-${catalogId}`)
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider: 'llamacpp', model: modelId })
    )
    navigate({
      to: route.home,
      replace: true,
      search: {
        threadModel: { id: modelId, provider: 'llamacpp' },
      },
    })
  }, [selected, navigate, selectModelProvider, serviceHub, setProviders])

  // Leaving setup is driven by the import event rather than by provider state,
  // which only refreshes afterwards. Warnings no longer gate this: each was its
  // own page and was passed deliberately before the model page was reached.
  useEffect(() => {
    const onModelImported = async (payload: { modelId: string }) => {
      if (!selected || hasNavigatedRef.current) return
      if (payload.modelId !== selected.modelId) return
      await completeSetup()
    }

    events.on(AppEvent.onModelImported, onModelImported)

    return () => {
      events.off(AppEvent.onModelImported, onModelImported)
    }
  }, [selected, completeSetup])

  useEffect(() => {
    if (quickStartQueued && selected && isSelectionReady) {
      setQuickStartQueued(false)
      startDownload(selected)
    }
  }, [quickStartQueued, selected, isSelectionReady, startDownload])

  // The model step reports the download the user starts here, so it is derived
  // from download state rather than from a readiness probe.
  // Named dependencies come from the same warning the standalone dialog would
  // have raised; the advice is rendered inline here instead.
  const dependencyWarning = warnings.find(
    (warning) => (warning.missingLibraries?.length ?? 0) > 0
  )
  const missingLibraries = dependencyWarning?.missingLibraries ?? []
  const dependencyBackend = dependencyWarning?.backend ?? ''

  const modelStep = useMemo<WizardStep>(() => {
    const model = selected?.displayName ?? ''
    const step = (
      status: SetupStageState['status'],
      messageKey: string,
      values?: Record<string, string | number>
    ): WizardStep => ({
      id: 'model',
      labelKey: 'setup:stageModel',
      status,
      messageKey,
      values,
    })

    if (isDownloaded) return step('ok', 'checkModelReady', { model })
    if (isDownloading) return step('running', 'checkModelDownloading', { model })
    if (!selected) return step('running', 'checkModelResolving')
    return step('pending', 'checkModelWaiting', {
      model,
      size: selected.fileSize || '',
    })
  }, [selected, isDownloaded, isDownloading])

  // One page at a time, each transient: it gives way as soon as its own
  // condition is met, and the model download is always last.
  //
  // The three readiness probes collapse into a single "set up llama.cpp" page:
  // the backend download and the embedding install are one wait from the user's
  // point of view, and the hardware probe only exists to label the GPU badge.
  const setupPage = useMemo<WizardStep>(() => {
    const byId = new Map(stages.map((stage) => [stage.id, stage]))
    const engine = byId.get('engine')
    const search = byId.get('search')
    const system = byId.get('system')

    // The first unresolved of the three decides what the page reports, so the
    // engine's own progress is shown before the checks that depend on it.
    const reporting =
      [engine, search, system].find((stage) => stage?.status === 'warning') ??
      [engine, search].find((stage) => stage?.status !== 'ok') ??
      engine

    return {
      id: 'setup',
      labelKey: 'setup:stageSetup',
      status: reporting?.status ?? 'pending',
      messageKey: reporting?.messageKey ?? '',
      values: reporting?.values,
      detail: reporting?.detail,
    }
  }, [stages])

  // Advanced only on the user's say-so. Auto-advancing skipped this page
  // entirely whenever the engine was already installed, which hid the GPU badge
  // -- the one thing on it the user cannot see anywhere else.
  const isSetupSettled = acknowledged.includes('setup')
  const isSetupComplete = ['engine', 'search', 'system'].every(
    (id) => stages.find((stage) => stage.id === id)?.status === 'ok'
  )
  /** The backend asset name, shown as a caption rather than as prose. */
  const engineBackendName = String(
    stages.find((stage) => stage.id === 'engine')?.values?.backend ?? ''
  )

  const pages = useMemo<WizardStep[]>(() => {
    const welcome: WizardStep = {
      id: 'welcome',
      labelKey: 'setup:welcomeTitle',
      status: 'pending',
      messageKey: '',
    }
    const consent: WizardStep[] = includesConsent
      ? [
          {
            id: 'consent',
            labelKey: 'setup:stageConsent',
            status: 'pending',
            messageKey: '',
          },
        ]
      : []
    return [welcome, setupPage, ...consent, modelStep]
  }, [setupPage, modelStep, includesConsent])

  const isPageSettled = useCallback(
    (page: WizardStep) => {
      switch (page.id) {
        case 'welcome':
          return hasStarted
        case 'setup':
          return isSetupSettled
        case 'consent':
          return !productAnalyticPrompt
        default:
          return Boolean(isDownloaded)
      }
    },
    [hasStarted, isSetupSettled, productAnalyticPrompt, isDownloaded]
  )

  const currentIndex = pages.findIndex((page) => !isPageSettled(page))
  const currentPage = currentIndex === -1 ? undefined : pages[currentIndex]

  // A model already on disk (a repeat visit, or one fetched from the Hub) leaves
  // no import event to wait for.
  useEffect(() => {
    if (currentIndex === -1 && !hasNavigatedRef.current) void completeSetup()
  }, [currentIndex, completeSetup])

  const acknowledge = useCallback((id: string) => {
    setAcknowledged((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  // Handle error when quick start is queued but metadata fetch fails
  useEffect(() => {
    if (quickStartQueued && metadataFetchFailed) {
      setQuickStartQueued(false)
      setQuickStartInitiated(false)
      toast.error(
        t('setup:quickStartFailed', {
          defaultValue: 'Something went wrong. Please try again.',
        })
      )
    }
  }, [quickStartQueued, metadataFetchFailed, t])

  useEffect(() => {
    if (
      quickStartInitiated &&
      !quickStartQueued &&
      isDownloading &&
      !isDownloaded
    ) {
      setQuickStartInitiated(false)
    }
  }, [quickStartInitiated, quickStartQueued, isDownloading, isDownloaded])


  const isWarning = currentPage?.status === 'warning'
  const isSetupPage = currentPage?.id === 'setup'

  // The engine reports its identity as a bare asset name, which is useful as a
  // caption but is not a sentence. The page supplies its own prose.
  const setupBody = isSetupComplete
    ? t('setup:setupDoneBody')
    : currentPage?.messageKey
      ? t(`setup:${currentPage.messageKey}`, currentPage.values)
      : t('setup:stageChecking')

  // The consent page has no subtitle of its own: AnalyticConsent's own detail
  // paragraph is the body, so a second one here would just repeat it.
  const body = () => {
    switch (currentPage?.id) {
      case 'welcome':
        return t('setup:welcomeBody')
      case 'model':
        return t('setup:description')
      case 'consent':
        return null
      default:
        return setupBody
    }
  }

  return (
    <div className="relative flex flex-col h-svh w-full overflow-hidden">
      <div className="flex flex-col h-svh w-full">
        <HeaderPage />

        <div className="flex h-[calc(100%-60px)] items-center justify-center px-6">
          <div
            className="w-full max-w-[460px] rounded-2xl border bg-card/60 p-7 shadow-xl pointer-events-auto"
            data-testid="setup-wizard"
            data-page={currentPage?.id ?? 'done'}
          >
            {currentPage && (
              <>
                <div className="flex items-center justify-between gap-4">
                  <span
                    className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
                    data-testid="setup-step-counter"
                  >
                    {t('setup:stepCounter', {
                      current: currentIndex + 1,
                      total: pages.length,
                    })}
                  </span>
                  {/* Segments rather than dots: they read as distance covered,
                      which is what a first-run flow needs to convey. */}
                  <span className="flex items-center gap-1" aria-hidden>
                    {pages.map((page, index) => (
                      <span
                        key={page.id}
                        className={cn(
                          'h-1 w-6 rounded-full transition-colors',
                          index === currentIndex
                            ? 'bg-primary'
                            : index < currentIndex
                              ? 'bg-muted-foreground/50'
                              : 'bg-muted-foreground/15'
                        )}
                      />
                    ))}
                  </span>
                </div>

                <div className="mt-6">
                  {isSetupPage && (
                    <span
                      className={cn(
                        'mb-4 inline-flex size-9 items-center justify-center rounded-xl',
                        isWarning
                          ? 'bg-destructive/10 text-destructive'
                          : isSetupComplete
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {isWarning ? (
                        <IconAlertTriangle size={18} />
                      ) : isSetupComplete ? (
                        <IconCheck size={18} />
                      ) : (
                        <IconLoader2 size={18} className="animate-spin" />
                      )}
                    </span>
                  )}
                  <h1 className="font-studio font-medium text-2xl tracking-tight">
                    {isSetupPage && isSetupComplete
                      ? t('setup:stageSetupDone')
                      : t(currentPage.labelKey)}
                  </h1>
                  {body() && (
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {body()}
                    </p>
                  )}
                </div>

                {currentPage.id === 'welcome' && (
                  <Button className="mt-6 w-full" onClick={beginSetup}>
                    {t('setup:startSetup')}
                  </Button>
                )}

                {/* The one fact a user cannot infer from a progress line:
                    whether the work they are waiting for lands on the GPU. */}
                {isSetupPage && (
                  <div
                    className={cn(
                      'mt-5 flex items-start gap-2.5 rounded-xl border px-3.5 py-3',
                      gpu.willUse
                        ? 'border-green-500/25 bg-green-500/8'
                        : 'border-border bg-muted/40'
                    )}
                    data-testid="setup-gpu-badge"
                  >
                    <span
                      className={cn(
                        'mt-0.5 shrink-0',
                        gpu.willUse ? 'text-green-400' : 'text-muted-foreground'
                      )}
                    >
                      {gpu.willUse === undefined ? (
                        <IconLoader2 size={15} className="animate-spin" />
                      ) : gpu.willUse ? (
                        <IconCheck size={15} />
                      ) : (
                        <IconCpu size={15} />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'text-sm font-medium',
                          gpu.willUse ? 'text-green-400' : 'text-foreground'
                        )}
                      >
                        {gpu.willUse === undefined
                          ? t('setup:badgeGpuUnknown')
                          : gpu.willUse
                            ? t('setup:badgeGpu')
                            : t('setup:badgeCpu')}
                      </p>
                      {gpu.label && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {gpu.label}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {isSetupPage && isWarning && (
                  <div className="mt-4" data-testid="setup-page-warning">
                    {warnings.length > 1 && (
                      <p className="mb-2 text-xs text-destructive">
                        {t('setup:otherWarnings', {
                          count: warnings.length - 1,
                        })}
                      </p>
                    )}
                    {currentPage.detail && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() => setShowDetails((prev) => !prev)}
                        >
                          {showDetails
                            ? t('setup:hideDetails')
                            : t('setup:showDetails')}
                        </button>
                        {showDetails && (
                          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                            {currentPage.detail}
                          </pre>
                        )}
                      </>
                    )}
                    {missingLibraries.length > 0 && (
                      <div className="mt-3">
                        <DependencyAdvice
                          backend={dependencyBackend}
                          missingLibraries={missingLibraries}
                        />
                      </div>
                    )}
                  </div>
                )}

                {isSetupPage && (
                  <>
                    {/* The engine's asset name: a caption, never the sentence. */}
                    {engineBackendName && (
                      <p className="mt-3 truncate font-mono text-[11px] text-muted-foreground/60">
                        {engineBackendName}
                      </p>
                    )}
                    <div className="mt-5 flex items-center gap-3">
                      {/* Continue once the work is done; the same button skips
                          ahead while it is still running, since this page covers
                          a backend download and waiting must not be the only
                          option. */}
                      <Button
                        className="flex-1"
                        onClick={() => acknowledge('setup')}
                      >
                        {isSetupComplete
                          ? t('setup:continueStep')
                          : isWarning
                            ? t('setup:continueAnyway')
                            : t('setup:skipStep')}
                      </Button>
                      {isWarning && !isRunning && (
                        <Button
                          variant="link"
                          onClick={() => void rerun()}
                          className="px-0"
                        >
                          {t('setup:retryChecks')}
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {currentPage.id === 'consent' && (
                  <div className="mt-5">
                    <AnalyticConsent />
                  </div>
                )}

                {currentPage.id === 'model' && (
                  <div className="mt-5">
                    <ModelCard
                      option={selected}
                      fallbackName={
                        janNewModel?.display_name ?? janNewModel?.model_name
                      }
                      progress={downloadProgress}
                      isDownloading={isDownloading}
                      isDownloaded={Boolean(isDownloaded)}
                      onDownload={handleQuickStart}
                    />
                    <button
                      type="button"
                      className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => navigate({ to: route.hub.index })}
                    >
                      {t('setup:exploreHub')}
                      <IconArrowRight size={12} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
