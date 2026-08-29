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
  IconRefresh,
  IconCode,
  IconEye,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { extractModelName, extractDescription } from '@/lib/models'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useEffect, useMemo, useCallback, useState } from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import { isSpecSidecar, pickSpecSibling } from '@/lib/specDraft'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { useTranslation } from '@/i18n'
import {
  getMirrorBase,
  rewriteModelscopeReadme,
  rewriteReadmeImages,
  sourceBase,
  type SearchSource,
} from '@/lib/searchSources'
import { buildDetailCatalogModel, type LiveCatalogModel } from '@/lib/liveHub'
import { startModelDownload } from '@/lib/modelDownloads'
import { ModelReadme } from '@/containers/ModelReadme'
import { toast } from 'sonner'

type SearchParams = {
  repo: string
  source?: SearchSource
}

type LoadStatus = 'loading' | 'error' | 'notfound' | 'ready'

export const Route = createFileRoute('/hub/$modelId')({
  component: HubModelDetailContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
    source: (search.source as SearchParams['source']) ?? undefined,
  }),
})

function HubModelDetailContent() {
  const { t } = useTranslation()
  const { modelId } = useParams({ from: Route.id })
  const navigate = useNavigate()
  const { huggingfaceToken } = useGeneralSetting()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useSearch({ from: Route.id as any })
  const { getProviderByName } = useModelProvider()
  const llamaProvider = getProviderByName('llamacpp')
  const {
    downloads,
    localDownloadingModels,
    addLocalDownloadingModel,
    setResumeParams,
  } = useDownloadStore()
  const serviceHub = useServiceHub()
  const [repoData, setRepoData] = useState<CatalogModel | undefined>()
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')

  // 详情页来源:live 搜索结果带 source 参数;默认走 HF 官方(原版逻辑)
  const source: SearchSource = search.source ?? 'hf'
  const isModelScope = source === 'modelscope'
  const repoId = (search.repo || modelId).replace(/\/+$/, '')

  // 返回 Hub 时带上搜索态(来源 + 搜索词取自会话快照),返回后搜索态/列表/滚动位置完整恢复
  const backToHub = useCallback(() => {
    const backSearch: Record<string, unknown> = { source }
    try {
      const session = JSON.parse(
        sessionStorage.getItem('hub-session-v1') || 'null'
      )
      if (session?.q) backSearch.q = session.q
    } catch {
      // 快照不可用时仅回来源
    }
    navigate({ to: route.hub.index, search: backSearch })
  }, [navigate, source])

  // State for README content
  const [readmeContent, setReadmeContent] = useState<string>('')
  const [isLoadingReadme, setIsLoadingReadme] = useState(false)
  // README 视图:渲染 / 原文
  const [readmeView, setReadmeView] = useState<'render' | 'raw'>('render')

  const fetchRepo = useCallback(async () => {
    setLoadStatus('loading')
    try {
      if (isModelScope || source === 'hf-mirror') {
        // 魔搭 / HF 镜像:走三源服务层(URL 与 README 地址跟随对应域名)
        const detail = await buildDetailCatalogModel(source, repoId)
        if (detail) {
          setRepoData(detail)
          setLoadStatus('ready')
        } else {
          setLoadStatus('notfound')
        }
        return
      }
      // HF 官方(原版逻辑保留)
      const repoInfo = await serviceHub
        .models()
        .fetchHuggingFaceRepo(repoId, huggingfaceToken)
      if (repoInfo) {
        const repoDetail = serviceHub
          .models()
          .convertHfRepoToCatalogModel(repoInfo)
        setRepoData(repoDetail || undefined)
        setLoadStatus('ready')
      } else {
        setLoadStatus('notfound')
      }
    } catch (e) {
      console.error('Failed to fetch model detail:', e)
      setLoadStatus('error')
    }
  }, [serviceHub, repoId, huggingfaceToken, isModelScope, source])

  useEffect(() => {
    fetchRepo()
  }, [modelId, fetchRepo])
  const modelData = repoData

  // Speculative draft companions are paired with a real quant at download
  // time, not standalone models — keep them out of the selectable variant list.
  const displayQuants = useMemo(
    () => modelData?.quants?.filter((q) => !isSpecSidecar(q)) ?? [],
    [modelData]
  )

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
          threadModel: {
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
      return t('hub:relativeDays', { days: diffDays })
    } else if (diffDays < 30) {
      return t('hub:relativeWeeks', { weeks: Math.floor(diffDays / 7) })
    } else if (diffDays < 365) {
      return t('hub:relativeMonths', { months: Math.floor(diffDays / 30) })
    } else {
      return t('hub:relativeYears', { years: Math.floor(diffDays / 365) })
    }
  }

  // Extract tags from quants (model variants)
  const tags = useMemo(() => {
    if (!displayQuants.length) return []
    const sizePattern = /(\d+b)/i
    const uniqueSizes = new Set<string>()

    displayQuants.forEach((quant) => {
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
  }, [displayQuants])

  // Fetch README content when modelData.readme is available
  useEffect(() => {
    if (modelData?.readme) {
      setIsLoadingReadme(true)
      const fetchWithAuth = (url: string) =>
        fetch(url).then((response) => {
          if (!response.ok && huggingfaceToken) {
            return fetch(url, {
              headers: { Authorization: `Bearer ${huggingfaceToken}` },
            })
          }
          return response
        })
      fetchWithAuth(modelData.readme)
        .then((response) => response.text())
        .then((content) => {
          // 相对路径图片重写为绝对地址(魔搭走 master 分支,HF/镜像走 main 分支),
          // 否则 README 里的 ./assets/x.png 这类图片会 404。
          let rewritten = content
          if (isModelScope) {
            rewritten = rewriteModelscopeReadme(content, repoId)
          } else {
            const base = sourceBase(source)
            rewritten = rewriteReadmeImages(
              content,
              `${base}/${repoId}/resolve/main/`
            )
          }
          setReadmeContent(rewritten)
          setIsLoadingReadme(false)
        })
        .catch(async () => {
          // HF 官方直连失败(需代理)→ 自动用镜像域名重试一次
          if (modelData?.readme?.startsWith('https://huggingface.co/')) {
            try {
              const mirrorUrl =
                getMirrorBase() +
                modelData.readme.slice('https://huggingface.co'.length)
              const resp = await fetch(mirrorUrl)
              if (resp.ok) {
                const content = await resp.text()
                setReadmeContent(content)
                setIsLoadingReadme(false)
                return
              }
            } catch {
              // 镜像也失败则按失败处理
            }
          }
          console.error('Failed to fetch README')
          setIsLoadingReadme(false)
        })
    }
  }, [modelData?.readme, huggingfaceToken, isModelScope, repoId])

  // 加载中 / 加载失败 / 不存在 三态
  if (!modelData) {
    return (
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <Button
            onClick={backToHub}
            aria-label="Go back"
            variant="ghost"
            size="sm"
          >
            <IconArrowLeft size={18} className="text-muted-foreground" />
            <span className="text-foreground">{t('hub:backToHub')}</span>
          </Button>
        </HeaderPage>
        <div className="flex-1 flex items-center justify-center px-6">
          {loadStatus === 'loading' ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <IconRefresh className="size-6 animate-spin" />
              <p>{t('hub:detailLoading')}</p>
            </div>
          ) : loadStatus === 'error' ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <p className="text-center">{t('hub:detailLoadFailed')}</p>
              <Button variant="secondary" size="sm" onClick={fetchRepo}>
                <IconRefresh size={14} className="mr-1" />
                {t('hub:detailRetry')}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">{t('hub:detailNotFound')}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <Button
            onClick={backToHub}
            aria-label="Go back"
            variant="ghost"
            size="sm"
            className="relative z-20"
          >
            <IconArrowLeft size={18} className="text-muted-foreground" />
            <span className="text-foreground">{t('hub:backToHub')}</span>
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
                {/* 来源标签(搜索下载源) */}
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-secondary text-muted-foreground">
                  {source === 'modelscope'
                    ? t('hub:sourceModelScope')
                    : source === 'hf-mirror'
                      ? t('hub:sourceHfMirror')
                      : t('hub:sourceHf')}
                </span>
                {modelData.developer && (
                  <>
                    <span>
                      {t('hub:by')} {modelData.developer}
                    </span>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <IconDownload size={16} />
                  <span>
                    {modelData.downloads || 0} {t('hub:downloads')}
                  </span>
                </div>
                {modelData.created_at && (
                  <div className="flex items-center gap-2">
                    <IconClock size={16} />
                    <span>
                      {t('hub:updated')} {formatDate(modelData.created_at)}
                    </span>
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

            {/* Variants Section */}
            {displayQuants.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <IconFileCode size={20} className="text-muted-foreground" />
                  <h2 className="text-lg font-semibold text-foreground">
                    {t('hub:variantsCount', { count: displayQuants.length })}
                  </h2>
                </div>

                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead>
                      <tr className="border-b ">
                        <th className="text-left py-3 px-2 text-sm font-medium">
                          {t('hub:version')}
                        </th>
                        <th className="text-left py-3 px-2 text-sm font-medium">
                          {t('hub:format')}
                        </th>
                        <th className="text-left py-3 px-2 text-sm font-medium">
                          {t('hub:size')}
                        </th>
                        <th></th>
                        <th className="text-right py-3 px-2 text-sm font-medium">
                          {t('hub:action')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayQuants.map((variant) => {
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

                        const format = variant.model_id
                          .toLowerCase()
                          .includes('tensorrt')
                          ? 'TensorRT'
                          : 'GGUF'

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
                              <span className="text-sm text-muted-foreground">
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
                                      <span className="text-xs text-muted-foreground text-right">
                                        {Math.round(downloadProgress * 100)}%
                                      </span>
                                    </div>
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
                                    >
                                      {t('hub:newChat')}
                                    </Button>
                                  )
                                }

                                return (
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (isModelScope) {
                                        // 魔搭:ms CLI 下载(无 CLI 自动回退直连)
                                        const mmprojVariant =
                                          modelData.mmproj_models?.find(
                                            (e) =>
                                              e.model_id.toLowerCase() ===
                                              'mmproj-f16'
                                          ) || modelData.mmproj_models?.[0]
                                        startModelDownload({
                                          model: modelData as LiveCatalogModel,
                                          variant,
                                          mmprojVariant,
                                          huggingfaceToken,
                                        }).catch((err) => {
                                          toast.error(t('hub:downloadFailed'), {
                                            description:
                                              err instanceof Error
                                                ? err.message
                                                : String(err),
                                          })
                                        })
                                        return
                                      }
                                      addLocalDownloadingModel(variant.model_id)
                                      const mmprojPath = (
                                        modelData.mmproj_models?.find(
                                          (e) =>
                                            e.model_id.toLowerCase() ===
                                            'mmproj-f16'
                                        ) || modelData.mmproj_models?.[0]
                                      )?.path
                                      const specDraft = pickSpecSibling(
                                        modelData.quants,
                                        variant
                                      )
                                      setResumeParams(variant.model_id, {
                                        modelPath: variant.path,
                                        mmprojPath,
                                        hfToken: huggingfaceToken,
                                      })
                                      serviceHub
                                        .models()
                                        .pullModelWithMetadata(
                                          variant.model_id,
                                          variant.path,
                                          mmprojPath,
                                          huggingfaceToken,
                                          undefined,
                                          specDraft?.quant.path,
                                          specDraft?.kind
                                        )
                                    }}
                                    className={cn(isDownloading && 'hidden')}
                                    variant="outline"
                                  >
                                    {t('hub:download')}
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
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <IconFileCode size={20} className="text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{t('hub:readme')}</h2>
                  </div>
                  {/* 渲染 / 原文 切换 */}
                  <div className="flex items-center gap-1 p-0.5 rounded bg-secondary">
                    <button
                      className={cn(
                        'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded cursor-pointer',
                        readmeView === 'render'
                          ? 'bg-card text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setReadmeView('render')}
                    >
                      <IconEye size={13} />
                      {t('hub:readmeRender')}
                    </button>
                    <button
                      className={cn(
                        'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded cursor-pointer',
                        readmeView === 'raw'
                          ? 'bg-card text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setReadmeView('raw')}
                    >
                      <IconCode size={13} />
                      {t('hub:readmeRaw')}
                    </button>
                  </div>
                </div>

                {isLoadingReadme ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-muted-foreground">
                      {t('hub:readmeLoading')}
                    </span>
                  </div>
                ) : readmeContent ? (
                  readmeView === 'raw' ? (
                    <pre className="max-h-[70vh] overflow-auto text-xs leading-relaxed p-4 rounded-lg border border-border bg-secondary">
                      {readmeContent}
                    </pre>
                  ) : (
                    <div className="markdown-body readme-detail max-w-none overflow-x-auto">
                      <ModelReadme content={readmeContent} />
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-muted-foreground">
                      {t('hub:readmeLoadFailed')}
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
