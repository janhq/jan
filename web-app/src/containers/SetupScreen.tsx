import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { AppEvent, DownloadEvent, EngineManager, events } from '@janhq/core'
import type { CatalogModel, ModelQuant } from '@/services/models/types'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn, sanitizeModelId } from '@/lib/utils'
import {
  extractModelName,
  getMlxTotalFileSize,
  getPreferredMmprojModel,
  getTotalDownloadFileSize,
} from '@/lib/models'
import { useResolvedRecommendedModels } from '@/hooks/useResolvedRecommendedModels'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import HeaderPage from './HeaderPage'
import SetupBackendStep from './SetupBackendStep'
import { useModelSources } from '@/hooks/useModelSources'
import { useShallow } from 'zustand/shallow'
import { HuggingFaceAuthorAvatar } from '@/components/HuggingFaceAuthorAvatar'
import { RecommendedModelChip } from '@/components/RecommendedModelChip'
import { chipVariantForRecommendedDescriptionKey } from '@/constants/recommendedModelChip'

//* Вариант загрузки: приоритет квантов как в Hub
function pickPreferredVariant(model: CatalogModel): ModelQuant | null {
  const preferred =
    model.quants?.find((m) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
        m.model_id.toLowerCase().includes(e)
      )
    ) ?? null
  return preferred ?? model.quants?.[0] ?? null
}

//* ГБ для строки прогресса (как в DownloadManagement)
function formatDownloadGb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2)
}

//* Иконка бренда по id репозитория HF (public/svg)
function recommendedSetupModelIconSrc(hfRepoId: string): string | null {
  const id = hfRepoId.toLowerCase()
  //? Distill-Qwen в названии DeepSeek — сначала deepseek, иначе попадём в Qwen
  if (id.includes('deepseek')) return '/svg/deepseek-color.svg'
  if (id.includes('gemma')) return '/svg/gemma-color.svg'
  if (id.includes('qwen')) return '/svg/qwen-color.svg'
  if (id.includes('llama') || id.includes('meta-llama'))
    return '/svg/meta-color.svg'
  return null
}

type SetupScreenProps = {
  onSkipped?: () => void
}

/// Onboarding step machine.
///   - 'backend' — Windows-only first step that detects the GPU and offers
///     to download the optimal llama.cpp backend. Skipped on macOS/Linux
///     and on Windows after the user has been through it once
///     (`localStorageKey.llamacppOnboardingDone` is set).
///   - 'model' — the existing model recommendation/selection screen.
type OnboardingStep = 'backend' | 'model'

function getInitialStep(): OnboardingStep {
  if (typeof window === 'undefined') return 'model'
  if (!IS_WINDOWS) return 'model'
  // Already completed the dedicated step in a previous session.
  if (localStorage.getItem(localStorageKey.llamacppOnboardingDone)) {
    return 'model'
  }
  return 'backend'
}

function SetupScreen({ onSkipped }: SetupScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getProviderByName, selectModelProvider, setProviders } =
    useModelProvider()

  const [step, setStep] = useState<OnboardingStep>(getInitialStep)

  const handleBackendStepDone = useCallback(
    (status: 'downloaded' | 'skipped') => {
      try {
        localStorage.setItem(localStorageKey.llamacppOnboardingDone, status)
      } catch (err) {
        console.warn(
          '[SetupScreen] failed to persist llamacpp onboarding flag',
          err
        )
      }
      setStep('model')
    },
    []
  )

  const {
    downloads,
    localDownloadingModels,
    resumableDownloads,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
  } = useDownloadStore()
  const serviceHub = useServiceHub()
  const llamaProvider = getProviderByName('llamacpp')
  const mlxProvider = getProviderByName('mlx')
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)

  const {
    sources,
    fetchSources,
    loading: sourcesLoading,
  } = useModelSources(
    useShallow((state) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  //* id → провайдер, чтобы после import-события знать, куда навигировать (llamacpp vs mlx)
  const trackedImportIdsRef = useRef<Map<string, 'llamacpp' | 'mlx'>>(new Map())
  const hasNavigatedRef = useRef(false)

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const recommendedItems = useResolvedRecommendedModels(sources)

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

  const isVariantDownloading = useCallback(
    (variantId: string) =>
      localDownloadingModels.has(variantId) ||
      downloadProcesses.some((e) => e.id === variantId),
    [localDownloadingModels, downloadProcesses]
  )

  const isVariantDownloaded = useCallback(
    (catalog: CatalogModel, variant: ModelQuant) =>
      llamaProvider?.models.some(
        (m: { id: string }) =>
          m.id === variant.model_id ||
          m.id === `${catalog.developer}/${sanitizeModelId(variant.model_id)}`
      ) ?? false,
    [llamaProvider]
  )

  //* MLX: id в реестре провайдера. ВАЖНО: MLX-движок использует свой sanitizer
  //* (сохраняет точки, пробелы → '-'), отличный от @/lib/utils.sanitizeModelId
  //* (который бы схлопнул '.' → '_'). Дублируем логику MlxModelDownloadAction.
  const getMlxModelId = useCallback(
    (catalog: CatalogModel) => {
      const raw = catalog.model_name.split('/').pop() ?? catalog.model_name
      return raw.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_./]/g, '')
    },
    []
  )

  const isMlxDownloaded = useCallback(
    (catalog: CatalogModel) => {
      const mlxId = getMlxModelId(catalog)
      return (
        mlxProvider?.models.some(
          (m: { id: string }) =>
            m.id === mlxId || m.id === `${catalog.developer}/${mlxId}`
        ) ?? false
      )
    },
    [mlxProvider, getMlxModelId]
  )

  const startDownload = useCallback(
    (catalog: CatalogModel, variant: ModelQuant) => {
      trackedImportIdsRef.current.set(variant.model_id, 'llamacpp')
      clearResumableDownload(variant.model_id)
      addLocalDownloadingModel(variant.model_id)
      serviceHub
        .models()
        .pullModelWithMetadata(
          variant.model_id,
          variant.path,
          getPreferredMmprojModel(catalog)?.path,
          huggingfaceToken,
          true,
          resumableDownloads.has(variant.model_id)
        )
    },
    [
      addLocalDownloadingModel,
      clearResumableDownload,
      serviceHub,
      huggingfaceToken,
      resumableDownloads,
    ]
  )

  //* MLX-скачивание (полная репликация логики MlxModelDownloadAction)
  const startMlxDownload = useCallback(
    async (catalog: CatalogModel) => {
      const mlxId = getMlxModelId(catalog)
      const modelPath = `${catalog.developer}/${catalog.model_name.split('/').pop()}`

      trackedImportIdsRef.current.set(mlxId, 'mlx')
      clearResumableDownload(mlxId)
      addLocalDownloadingModel(mlxId)

      try {
        const repoInfo = await serviceHub
          .models()
          .fetchHuggingFaceRepo(modelPath, huggingfaceToken)

        if (!repoInfo?.siblings?.length) {
          throw new Error('Failed to fetch repository files')
        }

        const modelFiles = repoInfo.siblings
        const mainSafetensorsFile = modelFiles.find((f) =>
          f.rfilename.toLowerCase().endsWith('.safetensors')
        )
        if (!mainSafetensorsFile) {
          throw new Error('No safetensors file found in repository')
        }

        const engine = EngineManager.instance().get('mlx')
        if (!engine) throw new Error('MLX engine not found')

        const modelUrl = `https://huggingface.co/${modelPath}/resolve/main/${mainSafetensorsFile.rfilename}`
        const extraFiles = modelFiles
          .filter((f) => f.rfilename !== mainSafetensorsFile.rfilename)
          .map((file) => ({
            url: `https://huggingface.co/${modelPath}/resolve/main/${file.rfilename}`,
            filename: file.rfilename,
          }))

        return engine.import(mlxId, {
          modelPath: modelUrl,
          files: extraFiles,
          resume: resumableDownloads.has(mlxId),
        })
      } catch (error) {
        console.error('Error downloading MLX model:', error)
        trackedImportIdsRef.current.delete(mlxId)
        markResumableDownload(mlxId)
        removeLocalDownloadingModel(mlxId)
        toast.error('Failed to download MLX model', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [
      addLocalDownloadingModel,
      removeLocalDownloadingModel,
      markResumableDownload,
      clearResumableDownload,
      serviceHub,
      huggingfaceToken,
      resumableDownloads,
      getMlxModelId,
    ]
  )

  useEffect(() => {
    const handleImportedId = async (
      importedId: string,
      providerName: 'llamacpp' | 'mlx'
    ) => {
      if (hasNavigatedRef.current) return
      hasNavigatedRef.current = true
      trackedImportIdsRef.current.delete(importedId)

      const providers = await serviceHub.providers().getProviders()
      setProviders(providers)

      const catalogId = importedId
      const backslashId = catalogId.replace(/\//g, '\\')
      const found =
        selectModelProvider(providerName, catalogId) ||
        selectModelProvider(providerName, backslashId)
      const modelId = found ? found.id : catalogId

      toast.dismiss(`model-validation-started-${catalogId}`)
      localStorage.setItem(localStorageKey.setupCompleted, 'true')
      // Notify the root layout so it can mount the global BackendUpdater
      // dialog now that the dedicated onboarding flow has completed.
      window.dispatchEvent(new Event('app:setup-completed'))
      localStorage.setItem(
        localStorageKey.lastUsedModel,
        JSON.stringify({ provider: providerName, model: modelId })
      )
      navigate({
        to: route.home,
        replace: true,
        search: {
          threadModel: { id: modelId, provider: providerName },
        },
      })
    }

    const onModelImported = (payload: { modelId: string }) => {
      const provider = trackedImportIdsRef.current.get(payload.modelId)
      if (!provider) return
      void handleImportedId(payload.modelId, provider)
    }

    //* MLX не всегда шлёт AppEvent.onModelImported — слушаем прямое событие загрузки
    const onMlxDownloadSuccess = (state: { modelId: string }) => {
      const provider = trackedImportIdsRef.current.get(state.modelId)
      if (provider !== 'mlx') return
      void handleImportedId(state.modelId, 'mlx')
    }

    events.on(AppEvent.onModelImported, onModelImported)
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      onMlxDownloadSuccess
    )

    return () => {
      events.off(AppEvent.onModelImported, onModelImported)
      events.off(
        DownloadEvent.onFileDownloadAndVerificationSuccess,
        onMlxDownloadSuccess
      )
    }
  }, [navigate, selectModelProvider, serviceHub, setProviders])

  const handleSkip = useCallback(() => {
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    // Same-tab signal — see useSetupCompleted in routes/__root.tsx.
    window.dispatchEvent(new Event('app:setup-completed'))
    localStorage.removeItem(localStorageKey.lastUsedModel)
    onSkipped?.()
    void navigate({
      to: route.home,
      replace: true,
      search: {},
    })
  }, [navigate, onSkipped])

  // Windows: dedicated llama.cpp backend step runs first. Once the user
  // either downloads or skips it the flag is persisted so subsequent
  // launches skip straight to model selection.
  if (step === 'backend') {
    return <SetupBackendStep onDone={handleBackendStepDone} />
  }

  return (
    <div className="relative flex h-svh w-full flex-col overflow-hidden">
      <div className="flex h-svh min-h-0 w-full flex-col">
        <HeaderPage />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="pointer-events-auto mx-auto my-auto flex w-full max-w-[840px] flex-col px-6 py-8 sm:px-10 sm:py-10">
            <div className="mb-4 shrink-0 text-center sm:mb-5">
              <div className="mb-5 flex items-center justify-center gap-3 font-studio text-5xl font-semibold leading-none tracking-tight sm:text-6xl">
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
              <div className="mb-3 min-w-0">
                <span className="inline-block text-lg font-bold leading-snug sm:text-xl md:text-2xl">
                  No rate limits. No subscriptions. No cloud.
                </span>
              </div>
              <p className="text-muted-foreground mx-auto max-w-full whitespace-nowrap text-sm leading-relaxed sm:text-base">
                {t('setup:turboQuantTagline')}
              </p>
            </div>

            <div className="relative z-50 flex flex-col gap-2">
              <div className="flex flex-col gap-2">
                <span className="shrink-0 text-left text-xs font-medium text-muted-foreground">
                  {t('hub:recTitle')}
                </span>
                <div
                  className={cn(
                    //* +20% только к внутренним отступам «карточки» (рамка со списком)
                    'w-full shrink-0 rounded-lg border bg-secondary/50 p-[0.9rem] sm:p-[1.2rem]',
                    'max-h-[min(70vh,36rem)] overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]'
                  )}
                >
                  <div className="flex flex-col divide-y divide-border/60">
                    {recommendedItems.map(({ rec, model }) => {
                      const isMlx = !!model?.is_mlx
                      const variant =
                        model && !isMlx ? pickPreferredVariant(model) : null
                      //* MLX: суммируем все safetensors-шарды; GGUF: quant + mmproj
                      const downloadSize = isMlx
                        ? getMlxTotalFileSize(model!)
                        : model && variant
                          ? getTotalDownloadFileSize(model, variant)
                          : variant?.file_size
                      //* id, по которому опрашиваем downloadStore (GGUF → quant.id, MLX → mlxId)
                      const rowTrackId = isMlx
                        ? model
                          ? getMlxModelId(model)
                          : null
                        : variant?.model_id ?? null
                      const rowDownloading = rowTrackId
                        ? isVariantDownloading(rowTrackId)
                        : false
                      const rowDownloaded = isMlx
                        ? model
                          ? isMlxDownloaded(model)
                          : false
                        : model && variant
                          ? isVariantDownloaded(model, variant)
                          : false
                      const hfAuthor =
                        model?.developer?.trim() ||
                        rec.modelName.split('/')[0]?.trim() ||
                        ''
                      const nameForInitials =
                        extractModelName(rec.modelName) || rec.modelName || '?'
                      const rowInitials =
                        nameForInitials
                          .replace(/\.(gguf|GGUF)$/i, '')
                          .replace(/[^a-zA-Z0-9]/g, '')
                          .slice(0, 2) ||
                        hfAuthor.slice(0, 2) ||
                        '?'

                      const brandIconSrc = recommendedSetupModelIconSrc(
                        rec.modelName
                      )
                      const rowDownloadProgress = rowTrackId
                        ? downloadProcesses.find((p) => p.id === rowTrackId)
                        : undefined

                      return (
                        <div
                          key={`${rec.modelName}-${rec.descriptionKey}`}
                          className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            {brandIconSrc ? (
                              <img
                                src={brandIconSrc}
                                alt=""
                                className="size-11 shrink-0 object-contain sm:size-12"
                                draggable={false}
                                aria-hidden
                              />
                            ) : (
                              <HuggingFaceAuthorAvatar
                                author={hfAuthor}
                                initials={rowInitials}
                                className="size-11 shrink-0 sm:size-12"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <h2 className="font-semibold text-sm leading-tight sm:text-base sm:whitespace-nowrap">
                                {model
                                  ? extractModelName(model.model_name)
                                  : extractModelName(rec.modelName)}
                                {downloadSize ? (
                                  <span className="text-xs font-normal text-muted-foreground">
                                    {' '}
                                    · {downloadSize}
                                  </span>
                                ) : null}
                              </h2>
                              <RecommendedModelChip
                                className="mt-1.5 inline-flex max-w-full sm:max-w-md"
                                variant={chipVariantForRecommendedDescriptionKey(
                                  rec.descriptionKey
                                )}
                                title={t(rec.descriptionKey)}
                              >
                                {t(rec.descriptionKey)}
                              </RecommendedModelChip>
                              {!model && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {sourcesLoading
                                    ? t('hub:loadingModels')
                                    : t('setup:modelUnavailable')}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex w-full flex-col items-center gap-1 sm:w-auto sm:shrink-0">
                            <Button
                              size="sm"
                              disabled={
                                !model ||
                                (!isMlx && !variant) ||
                                rowDownloading ||
                                rowDownloaded
                              }
                              onClick={() => {
                                if (!model) return
                                if (isMlx) {
                                  void startMlxDownload(model)
                                } else if (variant) {
                                  startDownload(model, variant)
                                }
                              }}
                              className="w-full shrink-0 rounded-full px-5 font-semibold sm:w-auto"
                            >
                              {rowDownloaded
                                ? t('hub:downloaded')
                                : rowDownloading
                                  ? t('setup:downloading')
                                  : t('hub:download')}
                            </Button>
                            {rowDownloading && rowTrackId ? (
                              <p
                                className="w-full text-center text-xs text-muted-foreground tabular-nums sm:w-auto sm:max-w-full"
                                aria-live="polite"
                              >
                                {rowDownloadProgress &&
                                rowDownloadProgress.total > 0
                                  ? `${Math.round((rowDownloadProgress.progress ?? 0) * 100)}% · ${formatDownloadGb(rowDownloadProgress.current)} / ${formatDownloadGb(rowDownloadProgress.total)} GB`
                                  : t('setup:downloadPreparing')}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="relative z-60 flex shrink-0 flex-col items-center pt-3">
                  <Button
                    type="button"
                    variant="link"
                    onClick={handleSkip}
                    className="text-muted-foreground/60 hover:text-muted-foreground relative z-60 h-auto p-0 text-xs font-normal underline-offset-4"
                  >
                    {t('setup:skip')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
