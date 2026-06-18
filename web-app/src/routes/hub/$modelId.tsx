import HeaderPage from '@/containers/HeaderPage'
import {
  createFileRoute,
  useParams,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import {
  IconArrowLeft,
  IconDownload,
  IconClock,
  IconFileCode,
  IconPlayerPause,
  IconPlayerPlay,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import {
  extractDescription,
  extractModelName,
  getMlxTotalFileSize,
  getPreferredMmprojModel,
  getTotalDownloadFileSize,
} from '@/lib/models'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useEffect, useMemo, useCallback, useState } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel, ModelQuant } from '@/services/models/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import {
  DEFAULT_MODEL_QUANTIZATIONS,
  RECOMMENDED_MODEL_FALLBACKS,
} from '@/constants/models'
import { useTranslation } from '@/i18n'
import { switchToModel } from '@/utils/switchModel'

type SearchParams = {
  repo: string
}

export const Route = createFileRoute('/hub/$modelId')({
  component: HubModelDetailContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function HubModelDetailContent() {
  const { t } = useTranslation()
  const { modelId } = useParams({ from: Route.id })
  const navigate = useNavigate()
  const { huggingfaceToken } = useGeneralSetting()
  const { sources, fetchSources } = useModelSources()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useSearch({ from: Route.id as any })
  const { getProviderByName } = useModelProvider()
  const llamaProvider = getProviderByName('llamacpp')
  const upstreamLlamaProvider = getProviderByName('llamacpp-upstream')
  const {
    downloads,
    localDownloadingModels,
    resumableDownloads,
    addLocalDownloadingModel,
    markResumableDownload,
    clearResumableDownload,
    pausedDownloads,
    markPausedDownload,
    clearPausedDownload,
    resumeParams,
  } = useDownloadStore()
  const serviceHub = useServiceHub()
  const [repoData, setRepoData] = useState<CatalogModel | undefined>()

  // State for README content
  const [readmeContent, setReadmeContent] = useState<string>('')
  const [isLoadingReadme, setIsLoadingReadme] = useState(false)

  // State for model support status
  const [modelSupportStatus, setModelSupportStatus] = useState<
    Record<string, 'RED' | 'YELLOW' | 'GREEN' | 'LOADING' | 'GREY'>
  >({})

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const fetchRepo = useCallback(async () => {
    const repoKey = search.repo || modelId
    const fallbackModel = RECOMMENDED_MODEL_FALLBACKS[repoKey]
    if (fallbackModel) {
      setRepoData(fallbackModel)
      return
    }

    const repoInfo = await serviceHub
      .models()
      .fetchHuggingFaceRepo(repoKey, huggingfaceToken)
    if (repoInfo) {
      const repoDetail = serviceHub
        .models()
        .convertHfRepoToCatalogModel(repoInfo)
      setRepoData(repoDetail || undefined)
    }
  }, [serviceHub, modelId, search, huggingfaceToken])

  useEffect(() => {
    fetchRepo()
  }, [modelId, fetchRepo])
  // Find the model data from sources
  const modelData = useMemo(() => {
    return sources.find((model) => model.model_name === modelId) ?? repoData
  }, [sources, modelId, repoData])

  // Download processes
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

  // ATO-154: only resumable model (GGUF) downloads can be paused. Backend
  // binaries (`llamacpp*`) and MLX repos (`mlx*`) are cancel-only — but the
  // variant table only ever lists GGUF quants, so this is a safety gate.
  const isPausableDownload = (id: string): boolean =>
    !id.startsWith('llamacpp') && !id.startsWith('mlx')

  const handlePauseDownload = useCallback(
    (id: string) => {
      markPausedDownload(id)
      markResumableDownload(id)
      void serviceHub.models().abortDownload(id)
    },
    [markPausedDownload, markResumableDownload, serviceHub]
  )

  const handleResumeDownload = useCallback(
    (id: string) => {
      const params = resumeParams[id]
      if (!params) {
        clearPausedDownload(id)
        return
      }
      clearPausedDownload(id)
      markResumableDownload(id)
      void serviceHub
        .models()
        .pullModelWithMetadata(
          id,
          params.modelPath,
          params.mmprojPath,
          params.hfToken,
          params.skipVerification ?? true,
          true
        )
        .catch((error) => {
          console.error('[HubModelDetail] resume failed:', error)
        })
    },
    [resumeParams, clearPausedDownload, markResumableDownload, serviceHub]
  )

  // Handle model use
  const handleUseModel = useCallback(
    (modelId: string) => {
      const allProviders = useModelProvider.getState().providers
      const upstream = allProviders.find(
        (p) => p.provider === 'llamacpp-upstream'
      )
      const fork = allProviders.find((p) => p.provider === 'llamacpp')
      const upstreamHasModel = upstream?.models.some((m) => m.id === modelId)
      const forkHasModel = fork?.models.some((m) => m.id === modelId)
      const targetLlamaProvider: 'llamacpp' | 'llamacpp-upstream' =
        upstreamHasModel
          ? 'llamacpp-upstream'
          : forkHasModel
            ? 'llamacpp'
            : upstream
              ? 'llamacpp-upstream'
              : 'llamacpp'

      console.log(
        '[hub/$modelId] handleUseModel:',
        modelId,
        '→ provider:',
        targetLlamaProvider,
        '(upstreamHasModel:',
        upstreamHasModel,
        'forkHasModel:',
        forkHasModel,
        ')'
      )

      useModelProvider
        .getState()
        .selectModelProvider(targetLlamaProvider, modelId)
      switchToModel({
        modelId,
        providerName: targetLlamaProvider,
        serviceHub,
      }).catch((error) => {
        console.error('[hub/$modelId] switchToModel failed:', error)
      })
      navigate({
        to: route.home,
        params: {},
        search: {
          threadModel: {
            id: modelId,
            provider: targetLlamaProvider,
          },
        },
      })
    },
    [navigate, serviceHub]
  )

  // Format the date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 7) {
      return `${diffDays} days ago`
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7)
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30)
      return `${months} month${months > 1 ? 's' : ''} ago`
    } else {
      const years = Math.floor(diffDays / 365)
      return `${years} year${years > 1 ? 's' : ''} ago`
    }
  }

  // Check model support function
  const checkModelSupport = useCallback(
    async (variant: ModelQuant) => {
      const modelKey = variant.model_id

      // Don't check again if already checking or checked
      if (modelSupportStatus[modelKey]) {
        return
      }

      // Set loading state
      setModelSupportStatus((prev) => ({
        ...prev,
        [modelKey]: 'LOADING',
      }))

      try {
        // Use the HuggingFace path for the model
        const modelPath = variant.path
        const supported = await serviceHub
          .models()
          .isModelSupported(modelPath, 8192)
        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: supported,
        }))
      } catch (error) {
        console.error('Error checking model support:', error)
        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: 'RED',
        }))
      }
    },
    [modelSupportStatus, serviceHub]
  )

  // Extract tags from quants (model variants)
  const tags = useMemo(() => {
    if (!modelData?.quants) return []
    // Extract unique size indicators from quant names
    const sizePattern = /(\d+b)/i
    const uniqueSizes = new Set<string>()

    modelData.quants.forEach((quant) => {
      const match = quant.model_id.match(sizePattern)
      if (match) {
        uniqueSizes.add(match[1].toLowerCase())
      }
    })

    return Array.from(uniqueSizes).sort((a, b) => {
      const numA = parseInt(a)
      const numB = parseInt(b)
      return numA - numB
    })
  }, [modelData])

  // Fetch README content when modelData.readme is available
  useEffect(() => {
    if (modelData?.readme) {
      setIsLoadingReadme(true)
      // Try fetching without headers first
      // There is a weird issue where this HF link will return error when access public repo with auth header
      fetch(modelData.readme)
        .then((response) => {
          if (!response.ok && huggingfaceToken && modelData?.readme) {
            // Retry with Authorization header if first fetch failed
            return fetch(modelData.readme, {
              headers: {
                Authorization: `Bearer ${huggingfaceToken}`,
              },
            })
          }
          return response
        })
        .then((response) => response.text())
        .then((content) => {
          setReadmeContent(content)
          setIsLoadingReadme(false)
        })
        .catch((error) => {
          console.error('Failed to fetch README:', error)
          setIsLoadingReadme(false)
        })
    }
  }, [modelData?.readme, huggingfaceToken])

  if (!modelData) {
    return (
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <Button
            onClick={() => navigate({ to: route.hub.index })}
            aria-label="Go back"
            variant="ghost"
            size="sm"
          >
            <IconArrowLeft size={18} className="text-muted-foreground" />
            <span className="text-foreground">{t('hub:backToModels')}</span>
          </Button>
        </HeaderPage>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Model not found</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <Button
            onClick={() => navigate({ to: route.hub.index })}
            aria-label="Go back"
            variant="ghost"
            size="sm"
            className="relative z-20"
          >
            <IconArrowLeft size={18} className="text-muted-foreground" />
            <span className="text-foreground">{t('hub:backToModels')}</span>
          </Button>
        </div>
      </HeaderPage>

      <div className="flex-1 overflow-y-auto ">
        <div className="md:w-4/5 mx-auto">
          <div className="max-w-4xl mx-auto p-6">
            {/* Model Header */}
            <div className="mb-8">
              <h1
                className="text-2xl font-semibold mb-4 capitalize wrap-break-word line-clamp-2"
                title={
                  extractModelName(modelData.model_name) || modelData.model_name
                }
              >
                {extractModelName(modelData.model_name) || modelData.model_name}
              </h1>

              {/* Stats */}
              <div className="flex items-center gap-4 text-sm text-foreground mb-4 flex-wrap">
                {modelData.developer && (
                  <>
                    <span>By {modelData.developer}</span>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <IconDownload size={16} />
                  <span>{modelData.downloads || 0} Downloads</span>
                </div>
                {modelData.created_at && (
                  <div className="flex items-center gap-2">
                    <IconClock size={16} />
                    <span>Updated {formatDate(modelData.created_at)}</span>
                  </div>
                )}
              </div>

              {/* Description */}
              {modelData.description && (
                <div className="text-muted-foreground mb-4">
                  <RenderMarkdown
                    className="select-none reset-heading"
                    components={{
                      a: ({ ...props }) => (
                        <a
                          {...props}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                    }}
                    content={
                      extractDescription(modelData.description) ||
                      modelData.description
                    }
                  />
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 text-sm bg-secondary rounded-md"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* MLX Download Section */}
            {modelData.is_mlx && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <IconDownload size={20} className="text-muted-foreground" />
                  <h2 className="text-lg font-semibold text-foreground">
                    Download
                  </h2>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {extractModelName(modelData.model_name) ||
                          modelData.model_name}
                      </span>
                      <span className="shrink-0 text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded-[6px] uppercase leading-tight border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                        MLX
                      </span>
                    </div>
                    {getMlxTotalFileSize(modelData) && (
                      <span className="text-xs text-muted-foreground">
                        {getMlxTotalFileSize(modelData)}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0">
                    <MlxModelDownloadAction model={modelData} />
                  </div>
                </div>
              </div>
            )}

            {/* Variants Section */}
            {modelData.quants && modelData.quants.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <IconFileCode size={20} className="text-muted-foreground" />
                  <h2 className="text-lg font-semibold text-foreground">
                    Variants ({modelData.quants.length})
                  </h2>
                </div>

                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead>
                      <tr className="border-b ">
                        <th className="text-left py-3 px-2 text-sm font-medium">
                          Version
                        </th>
                        <th className="text-left py-3 px-2 text-sm font-medium">
                          Format
                        </th>
                        <th className="text-left py-3 px-2 text-sm font-medium">
                          Size
                        </th>
                        <th></th>
                        <th className="text-right py-3 px-2 text-sm font-medium w-[150px]">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelData.quants.map((variant) => {
                        const isDownloading =
                          localDownloadingModels.has(variant.model_id) ||
                          downloadProcesses.some(
                            (e) => e.id === variant.model_id
                          )
                        const downloadProgress =
                          downloadProcesses.find(
                            (e) => e.id === variant.model_id
                          )?.progress || 0
                        const downloadedProvider = llamaProvider?.models.some(
                          (m: { id: string }) => m.id === variant.model_id
                        )
                          ? llamaProvider
                          : upstreamLlamaProvider?.models.some(
                                (m: { id: string }) => m.id === variant.model_id
                              )
                            ? upstreamLlamaProvider
                            : undefined
                        const isDownloaded = Boolean(downloadedProvider)

                        // Extract format from model_id
                        const format = variant.model_id
                          .toLowerCase()
                          .includes('tensorrt')
                          ? 'TensorRT'
                          : 'GGUF'

                        // Extract version name (remove format suffix)
                        const versionName = variant.model_id
                          .replace(/_GGUF$/i, '')
                          .replace(/-GGUF$/i, '')
                          .replace(/_TensorRT$/i, '')
                          .replace(/-TensorRT$/i, '')

                        return (
                          <tr
                            key={variant.model_id}
                            className="border-b border-border"
                          >
                            <td className="py-3 px-2">
                              <span className="text-sm font-medium">
                                {versionName}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <span className="text-sm text-muted-foreground">
                                {format}
                              </span>
                            </td>
                            <td className="py-3 px-2">
                              <div className="flex items-center gap-1">
                                <span className="text-sm text-muted-foreground">
                                  {getTotalDownloadFileSize(modelData, variant)}
                                </span>
                                {downloadedProvider && (
                                  <DialogDeleteModel
                                    provider={downloadedProvider}
                                    modelId={variant.model_id}
                                  />
                                )}
                              </div>
                            </td>
                            <td>
                              <ModelInfoHoverCard
                                model={modelData}
                                variant={variant}
                                defaultModelQuantizations={
                                  DEFAULT_MODEL_QUANTIZATIONS
                                }
                                modelSupportStatus={modelSupportStatus}
                                onCheckModelSupport={checkModelSupport}
                              />
                            </td>
                            <td className="py-3 px-2 text-right ml-auto">
                              {(() => {
                                if (isDownloading && !isDownloaded) {
                                  const pausable = isPausableDownload(
                                    variant.model_id
                                  )
                                  const isPaused = pausedDownloads.has(
                                    variant.model_id
                                  )
                                  return (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      disabled={!pausable}
                                      onClick={() => {
                                        if (!pausable) return
                                        if (isPaused) {
                                          handleResumeDownload(variant.model_id)
                                        } else {
                                          handlePauseDownload(variant.model_id)
                                        }
                                      }}
                                      title={
                                        isPaused
                                          ? t('common:resumeDownload')
                                          : t('common:pauseDownload')
                                      }
                                      aria-label={
                                        isPaused
                                          ? t('common:resumeDownload')
                                          : t('common:pauseDownload')
                                      }
                                      className="group relative ml-auto w-24 justify-center overflow-hidden font-semibold"
                                    >
                                      <span
                                        aria-hidden
                                        className="absolute inset-y-0 left-0 z-0 bg-primary/20 transition-[width] duration-200"
                                        style={{
                                          width: `${Math.round(downloadProgress * 100)}%`,
                                        }}
                                      />
                                      <span
                                        className={cn(
                                          'relative z-1 tabular-nums transition-opacity',
                                          pausable && 'group-hover:opacity-0'
                                        )}
                                      >
                                        {Math.round(downloadProgress * 100)}%
                                      </span>
                                      {pausable && (
                                        <span className="absolute inset-0 z-1 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                                          {isPaused ? (
                                            <IconPlayerPlay size={14} />
                                          ) : (
                                            <IconPlayerPause size={14} />
                                          )}
                                        </span>
                                      )}
                                    </Button>
                                  )
                                }

                                if (isDownloaded) {
                                  return (
                                    <Button
                                      variant="default"
                                      size="sm"
                                      onClick={() =>
                                        handleUseModel(variant.model_id)
                                      }
                                      className="ml-auto w-24 justify-center"
                                    >
                                      {t('hub:newChat')}
                                    </Button>
                                  )
                                }

                                return (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      clearResumableDownload(variant.model_id)
                                      addLocalDownloadingModel(variant.model_id)
                                      serviceHub
                                        .models()
                                        .pullModelWithMetadata(
                                          variant.model_id,
                                          variant.path,
                                          getPreferredMmprojModel(modelData)
                                            ?.path,
                                          huggingfaceToken,
                                          true,
                                          resumableDownloads.has(
                                            variant.model_id
                                          )
                                        )
                                    }}
                                    className={cn(
                                      'ml-auto w-24 justify-center',
                                      isDownloading && 'hidden'
                                    )}
                                    variant="outline"
                                  >
                                    Download
                                  </Button>
                                )
                              })()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* README Section */}
            {modelData.readme && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <IconFileCode size={20} className="text-muted-foreground" />
                  <h2 className="text-lg font-semibold">README</h2>
                </div>

                {isLoadingReadme ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-muted-foreground">
                      Loading README...
                    </span>
                  </div>
                ) : readmeContent ? (
                  <div className="prose prose-invert max-w-none">
                    <RenderMarkdown
                      components={{
                        a: ({ ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                      }}
                      content={readmeContent}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-muted-foreground">
                      Failed to load README
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
