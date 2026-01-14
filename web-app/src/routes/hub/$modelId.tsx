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
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'
import { extractModelName, extractDescription } from '@/lib/models'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useEffect, useMemo, useCallback, useState } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel, ModelQuant } from '@/services/models/types'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { useTranslation } from '@/i18n'

type SearchParams = {
  repo: string
}

export const Route = createFileRoute('/hub/$modelId')({
  component: HubModelDetail,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function HubModelDetail() {
  return (
    <PlatformGuard feature={PlatformFeature.MODEL_HUB}>
      <HubModelDetailContent />
    </PlatformGuard>
  )
}

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
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
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
    const repoInfo = await serviceHub
      .models()
      .fetchHuggingFaceRepo(search.repo || modelId, huggingfaceToken)
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

  // Handle model use
  const handleUseModel = useCallback(
    (modelId: string) => {
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: modelId,
            provider: 'llamacpp',
          },
        },
      })
    },
    [navigate]
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
      <div className="flex h-full w-full">
        <div className="flex flex-col h-full w-full">
          <HeaderPage>
            <button
              className="relative z-20 flex items-center gap-2 cursor-pointer"
              onClick={() => navigate({ to: route.hub.index })}
              aria-label="Go back"
            >
              <div className="flex items-center justify-center size-5 rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
                <IconArrowLeft size={18} className="text-main-view-fg" />
              </div>
              <span className="text-main-view-fg">Back to Hub</span>
            </button>
          </HeaderPage>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-main-view-fg/60">Model not found</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full">
      <div className="flex flex-col h-full w-full ">
        <HeaderPage>
          <button
            className="relative z-20 flex items-center gap-2 cursor-pointer"
            onClick={() => navigate({ to: route.hub.index })}
            aria-label="Go back"
          >
            <div className="flex items-center justify-center size-5 rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out">
              <IconArrowLeft size={18} className="text-main-view-fg" />
            </div>
            <span className="text-main-view-fg">Back to Hub</span>
          </button>
        </HeaderPage>

        <div className="flex-1 overflow-y-auto ">
          <div className="md:w-4/5 mx-auto">
            <div className="max-w-4xl mx-auto p-6">
              {/* Model Header */}
              <div className="mb-8">
                <h1
                  className="text-2xl font-semibold text-main-view-fg mb-4 capitalize break-words line-clamp-2"
                  title={
                    extractModelName(modelData.model_name) ||
                    modelData.model_name
                  }
                >
                  {extractModelName(modelData.model_name) ||
                    modelData.model_name}
                </h1>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm text-main-view-fg/60 mb-4 flex-wrap">
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
                  <div className="text-main-view-fg/80 mb-4">
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
                        className="px-3 py-1 text-sm bg-main-view-fg/10 text-main-view-fg rounded-md"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Variants Section */}
              {modelData.quants && modelData.quants.length > 0 && (
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <IconFileCode size={20} className="text-main-view-fg/50" />
                    <h2 className="text-lg font-semibold text-main-view-fg">
                      Variants ({modelData.quants.length})
                    </h2>
                  </div>

                  <div className="w-full overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead>
                        <tr className="border-b border-main-view-fg/10">
                          <th className="text-left py-3 px-2 text-sm font-medium text-main-view-fg/70">
                            Version
                          </th>
                          <th className="text-left py-3 px-2 text-sm font-medium text-main-view-fg/70">
                            Format
                          </th>
                          <th className="text-left py-3 px-2 text-sm font-medium text-main-view-fg/70">
                            Size
                          </th>
                          <th></th>
                          <th className="text-right py-3 px-2 text-sm font-medium text-main-view-fg/70">
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
                          const isDownloaded = llamaProvider?.models.some(
                            (m: { id: string }) => m.id === variant.model_id
                          )

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
                              className="border-b border-main-view-fg/5 hover:bg-main-view-fg/5"
                            >
                              <td className="py-3 px-2">
                                <span className="text-sm text-main-view-fg/80 font-medium">
                                  {versionName}
                                </span>
                              </td>
                              <td className="py-3 px-2">
                                <span className="text-sm text-main-view-fg/60">
                                  {format}
                                </span>
                              </td>
                              <td className="py-3 px-2">
                                <span className="text-sm text-main-view-fg/60">
                                  {variant.file_size}
                                </span>
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
                                    return (
                                      <div className="flex items-center justify-end gap-2">
                                        <Progress
                                          value={downloadProgress * 100}
                                          className="w-12"
                                        />
                                        <span className="text-xs text-main-view-fg/70 text-right">
                                          {Math.round(downloadProgress * 100)}%
                                        </span>
                                      </div>
                                    )
                                  }

                                  if (isDownloaded) {
                                    return (
                                      <Button
                                        variant="link"
                                        size="sm"
                                        className="p-0"
                                        onClick={() =>
                                          handleUseModel(variant.model_id)
                                        }
                                      >
                                        <div className="rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1">
                                          {t('hub:newChat')}
                                        </div>
                                      </Button>
                                    )
                                  }

                                  return (
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        addLocalDownloadingModel(
                                          variant.model_id
                                        )
                                        serviceHub
                                          .models()
                                          .pullModelWithMetadata(
                                            variant.model_id,
                                            variant.path,
                                            (
                                              modelData.mmproj_models?.find(
                                                (e) =>
                                                  e.model_id.toLowerCase() ===
                                                  'mmproj-f16'
                                              ) || modelData.mmproj_models?.[0]
                                            )?.path,
                                            huggingfaceToken
                                          )
                                      }}
                                      className={cn(isDownloading && 'hidden')}
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
                    <IconFileCode size={20} className="text-main-view-fg/50" />
                    <h2 className="text-lg font-semibold text-main-view-fg">
                      README
                    </h2>
                  </div>

                  {isLoadingReadme ? (
                    <div className="flex items-center justify-center py-8">
                      <span className="text-main-view-fg/60">
                        Loading README...
                      </span>
                    </div>
                  ) : readmeContent ? (
                    <div className="prose prose-invert max-w-none">
                      <RenderMarkdown
                        className="text-main-view-fg/80"
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
                      <span className="text-main-view-fg/60">
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
    </div>
  )
}
