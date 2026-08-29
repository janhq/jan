/* eslint-disable @typescript-eslint/no-explicit-any */
import { useVirtualizer } from '@tanstack/react-virtual'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn, formatBytes, sanitizeModelId } from '@/lib/utils'
import { sumMlxModelBytes } from '@/lib/modelCompatibility'
import { isSpecSidecar } from '@/lib/specDraft'
import {
  useState,
  useMemo,
  useEffect,
  useLayoutEffect,
  ChangeEvent,
  useCallback,
  useRef,
  useTransition,
  createContext,
  useContext,
} from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Card, CardItem } from '@/containers/Card'
import {
  extractModelName,
  extractDescription,
  selectDefaultQuant,
} from '@/lib/models'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconExternalLink,
  IconFileCode,
  IconEye,
  IconRefresh,
  IconSearch,
  IconTool,
} from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CatalogModel } from '@/services/models/types'
import HeaderPage from '@/containers/HeaderPage'
import { ChevronsUpDown, Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import {
  ModelScopeCardDownloadAction,
  ModelScopeVariantDownloadAction,
} from '@/containers/ModelScopeDownloadAction'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import {
  fetchModelDetails,
  fetchRecommended,
  searchModelsPage,
  setMirrorBase,
  sourceBase,
  type SearchQuant,
  type SearchSource,
} from '@/lib/searchSources'
import {
  applyModelDetails,
  formatRelativeDate,
  searchModelToCatalogModel,
  type LiveCatalogModel,
} from '@/lib/liveHub'
import { useHubSettings } from '@/lib/hubSettings'
import { useModelIntro } from '@/lib/introStore'

type SearchParams = {
  repo: string
  /** 搜索词写进 URL:进详情页返回/刷新后搜索态不丢 */
  q?: string
  source?: SearchSource
}

type QuantTier = {
  labelKey: string
  className: string
}

function getQuantTier(modelId: string): QuantTier | null {
  const id = modelId.toLowerCase()
  if (/(^|[-_.])(f32|bf16|f16|q8|q6)([-_.]|$)/.test(id)) {
    return {
      labelKey: 'hub:tierLarge',
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    }
  }
  if (/(^|[-_.])(q5|q4_k|iq4)/.test(id)) {
    return {
      labelKey: 'hub:tierBalanced',
      className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    }
  }
  if (/(^|[-_.])(iq2|iq3|q2|q3|q4_0|q4_1)/.test(id)) {
    return {
      labelKey: 'hub:tierSmall',
      className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    }
  }
  return null
}

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
    q: search.q as SearchParams['q'],
    source: search.source as SearchParams['source'],
  }),
})

const SOURCE_OPTIONS: { value: SearchSource; labelKey: string }[] = [
  { value: 'hf-mirror', labelKey: 'hub:sourceHfMirror' },
  { value: 'hf', labelKey: 'hub:sourceHf' },
  { value: 'modelscope', labelKey: 'hub:sourceModelScope' },
]

// 网络请求超时:避免 HF 官方等源在受限网络下无限挂起(一直被拦着,
// 用户只能看到"0 结果"+ 骨架屏,迟迟没有失败提示)。
const SEARCH_TIMEOUT_MS = 8000

/** 给 Promise 加超时,超时则以 TimeoutError 拒绝(上层据此提示"网络超时")。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Request timed out'), { name: 'TimeoutError' }))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/* 卡片行共享回调(虚拟列表行组件通过 context 获取,避免逐行传 props) */
type HubCardCtx = {
  handleUseModel: (modelId: string) => void
  toggleModelExpansion: (modelId: string) => void
  isRecommendedModel: (modelId: string) => boolean
  onOpenDetail: (model: CatalogModel) => void
}

const HubCardContext = createContext<HubCardCtx | null>(null)

/**
 * 单个模型卡片行。实时搜索结果(live=true)在挂载后懒加载量化列表,
 * 加载完成后合并进模型对象,渲染层与静态目录卡片完全一致。
 */
function HubModelRow({
  model,
  live,
  isExpanded,
}: {
  model: CatalogModel
  live: boolean
  isExpanded: boolean
}) {
  const ctx = useContext(HubCardContext)
  const { t } = useTranslation()
  const liveModel = live ? (model as LiveCatalogModel) : null

  const [details, setDetails] = useState<{
    quants: SearchQuant[]
    mmprojFiles: string[]
  } | null>(null)

  useEffect(() => {
    if (!liveModel) return
    // 已有量化列表(如从详情页带回)则无需再拉取
    if ((model.quants?.length ?? 0) > 0) return
    let cancelled = false
    setDetails(null)
    fetchModelDetails(liveModel.source, liveModel.repoId)
      .then((d) => {
        if (!cancelled) setDetails(d)
      })
      .catch(() => {
        if (!cancelled) setDetails({ quants: [], mmprojFiles: [] })
      })
    return () => {
      cancelled = true
    }
  }, [liveModel?.repoId, liveModel?.source])

  const displayModel = useMemo(() => {
    if (!liveModel) return model
    return details
      ? applyModelDetails(liveModel, details.quants, details.mmprojFiles)
      : liveModel
  }, [liveModel, model, details])

  // 简介:README 提取(可信检查)+ 结构化兜底,本地缓存 30 天,可手动刷新
  const structuredIntro = extractDescription(displayModel?.description) ?? ''
  const { intro: modelIntro, refresh: refreshIntro } = useModelIntro(
    liveModel?.source,
    liveModel?.repoId,
    liveModel?.display_name,
    structuredIntro
  )

  // 外链地址:实时结果跳源网页,静态目录跳 HuggingFace 仓库页
  const externalUrl = liveModel
    ? `${sourceBase(liveModel.source)}/${liveModel.repoId}`
    : `https://huggingface.co/${model.developer ? `${model.developer}/` : ''}${model.model_name}`

  const modelName = displayModel.model_name

  return (
    <Card
      header={
        <div className="flex items-start justify-between gap-x-3">
          <div
            className="cursor-pointer min-w-0 flex-1"
            onClick={() => ctx?.onOpenDetail(displayModel)}
          >
            <h1
              className={cn(
                'text-foreground font-medium text-base capitalize sm:max-w-none',
                ctx?.isRecommendedModel(modelName) ? 'hub-model-card-step' : ''
              )}
              title={extractModelName(modelName) || ''}
            >
              {extractModelName(modelName) || ''}
            </h1>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium text-xs">
                {displayModel.is_mlx
                  ? formatBytes(sumMlxModelBytes(displayModel) || undefined)
                  : selectDefaultQuant(
                      displayModel.quants,
                      DEFAULT_MODEL_QUANTIZATIONS
                    )?.file_size}
              </span>
              <ModelInfoHoverCard
                model={displayModel}
                defaultModelQuantizations={DEFAULT_MODEL_QUANTIZATIONS}
                variant={selectDefaultQuant(
                  displayModel.quants,
                  DEFAULT_MODEL_QUANTIZATIONS
                )}
                isDefaultVariant={true}
              />
              {/* 外链按钮:在当前源网页打开详情 */}
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="size-6 flex items-center justify-center rounded transition-all duration-200 ease-in-out hover:bg-secondary"
                title={t('hub:openInBrowser')}
              >
                <IconExternalLink size={14} className="text-muted-foreground" />
              </a>
              {/* 简介刷新按钮(仅实时搜索结果,30 天缓存可手动刷新) */}
              {liveModel && (
                <button
                  onClick={refreshIntro}
                  className="size-6 flex items-center justify-center rounded transition-all duration-200 ease-in-out hover:bg-secondary"
                  title={t('hub:refreshIntro')}
                >
                  <IconRefresh size={14} className="text-muted-foreground" />
                </button>
              )}
            </div>
            {displayModel.is_mlx ? (
              <MlxModelDownloadAction model={displayModel} />
            ) : liveModel?.source === 'modelscope' ? (
              <ModelScopeCardDownloadAction
                model={liveModel}
                handleUseModel={ctx?.handleUseModel ?? (() => {})}
              />
            ) : (
              <DownloadButtonPlaceholder
                model={displayModel}
                handleUseModel={ctx?.handleUseModel ?? (() => {})}
              />
            )}
          </div>
        </div>
      }
    >
      <div className="line-clamp-2 mt-3 text-muted-foreground leading-normal">
        <RenderMarkdown
          className="select-none reset-heading"
          components={{
            a: ({ ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
          content={
            modelIntro || extractDescription(displayModel?.description) || ''
          }
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <span className="capitalize text-foreground">
          {t('hub:by')} {displayModel?.developer}
        </span>
        {formatRelativeDate(displayModel?.created_at) && (
          <span
            className="text-muted-foreground text-xs"
            title={displayModel?.created_at}
          >
            · {formatRelativeDate(displayModel?.created_at)}
          </span>
        )}
        <div className="flex items-center gap-4 ml-2">
          <div className="flex items-center gap-1">
            <IconDownload
              size={18}
              className="text-muted-foreground"
              title={t('hub:downloads')}
            />
            <span className="text-foreground">
              {displayModel.downloads || 0}
            </span>
          </div>
          {!displayModel.is_mlx && (
            <div className="flex items-center gap-1">
              <IconFileCode
                size={20}
                className="text-muted-foreground"
                title={t('hub:variants')}
              />
              <span className="text-foreground">
                {displayModel.quants?.length || 0}
              </span>
            </div>
          )}
          {displayModel.is_mlx && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                  MLX
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>Requires MLX engine (Apple Silicon only)</p>
              </TooltipContent>
            </Tooltip>
          )}
          <div className="flex gap-1.5 items-center">
            {(displayModel.num_mmproj ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-foreground/80">
                <IconEye size={13} />
                {t('multimodal')}
              </span>
            )}
            {liveModel?.source === 'modelscope' ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground/50 cursor-help">
                    <IconTool size={13} />
                    {t('tools')}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('hub:toolsNotProvided')}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              displayModel.tools && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-foreground/80">
                  <IconTool size={13} />
                  {t('tools')}
                </span>
              )
            )}
          </div>
        </div>
        {(displayModel.quants?.length ?? 0) > 1 && (
          <button
            className="flex items-center gap-1 hub-show-variants-step ml-auto"
            onClick={() => ctx?.toggleModelExpansion(modelName)}
          >
            <span className="text-foreground">{t('hub:showVariants')}</span>
            {isExpanded ? (
              <IconChevronUp size={18} className="text-muted-foreground" />
            ) : (
              <IconChevronDown size={18} className="text-muted-foreground" />
            )}
          </button>
        )}
      </div>
      {isExpanded &&
        (displayModel.quants?.length ?? 0) > 0 &&
        (() => {
          const quants = displayModel.quants ?? []
          const recommendedId = selectDefaultQuant(
            quants,
            DEFAULT_MODEL_QUANTIZATIONS
          )?.model_id
          return (
            <div className="mt-5">
              {quants.map((variant) => (
                <CardItem
                  key={variant.model_id}
                  title={
                    <div className="flex items-center gap-2">
                      <span>{variant.model_id}</span>
                      {(() => {
                        const tier = getQuantTier(variant.model_id)
                        return tier ? (
                          <span
                            className={cn(
                              'text-xs font-medium px-1.5 py-0.5 rounded',
                              tier.className
                            )}
                          >
                            {t(tier.labelKey)}
                          </span>
                        ) : null
                      })()}
                      {variant.model_id === recommendedId && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {t('hub:recommended')}
                        </span>
                      )}
                    </div>
                  }
                  actions={
                    <div className="flex items-center gap-2">
                      <p className="text-muted-foreground font-medium text-xs">
                        {variant.file_size}
                      </p>
                      <ModelInfoHoverCard
                        model={displayModel}
                        variant={variant}
                        defaultModelQuantizations={DEFAULT_MODEL_QUANTIZATIONS}
                      />
                      {displayModel.is_mlx ? (
                        <MlxModelDownloadAction model={displayModel} />
                      ) : liveModel?.source === 'modelscope' ? (
                        <ModelScopeVariantDownloadAction
                          model={liveModel}
                          variant={variant}
                          handleUseModel={ctx?.handleUseModel ?? (() => {})}
                        />
                      ) : (
                        <ModelDownloadAction
                          variant={variant}
                          model={displayModel}
                        />
                      )}
                    </div>
                  }
                />
              ))}
            </div>
          )
        })()}
    </Card>
  )
}

function HubContent() {
  const [isPending] = useTransition()
  const parentRef = useRef<HTMLDivElement | null>(null)

  const { t } = useTranslation()

  const sortOptions = [
    { value: 'newest', name: t('hub:sortNewest') },
    { value: 'most-downloaded', name: t('hub:sortMostDownloaded') },
    ...(IS_MACOS
      ? [
          { value: 'mlx', name: 'MLX' },
          { value: 'gguf', name: 'GGUF' },
        ]
      : []),
  ]

  const navigate = useNavigate()
  const urlSearch = useSearch({ from: Route.id as any })

  const [activeSource, setActiveSource] = useState<SearchSource>(
    (urlSearch.source as SearchSource) === 'hf' ||
      (urlSearch.source as SearchSource) === 'modelscope'
      ? (urlSearch.source as SearchSource)
      : 'hf'
  )
  const [searchState, setSearchState] = useState<{
    models: LiveCatalogModel[]
    total: number
    page: number
    hasMore: boolean
  }>({ models: [], total: 0, page: 0, hasMore: false })
  const [liveSearching, setLiveSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchValue, setSearchValue] = useState(urlSearch.q ?? '')
  // 空搜索推荐(跟随当前 tab):魔搭官方推荐 / HF trending
  const [recommended, setRecommended] = useState<LiveCatalogModel[]>([])
  const [recommendError, setRecommendError] = useState(false)
  const [recommendLoading, setRecommendLoading] = useState(false)
  // 重试计数器:点击重试时自增,驱动对应 effect 重新拉取
  const [searchRetry, setSearchRetry] = useState(0)
  const [recommendRetry, setRecommendRetry] = useState(0)
  // 区分"网络超时"与普通失败,用于展示不同的失败提示
  const [searchTimedOut, setSearchTimedOut] = useState(false)
  const [sortSelected, setSortSelected] = useState('newest')
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )
  const [showOnlyDownloaded, setShowOnlyDownloaded] = useState(false)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // 从详情页返回时恢复:搜索词相同则直接用快照列表(零请求)+ 恢复滚动位置
  const HUB_SESSION_KEY = 'hub-session-v1'
  const restoredSession = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem(HUB_SESSION_KEY) || 'null')
    } catch {
      return null
    }
  }, [])
  const sessionRestored = useMemo(() => {
    if (!restoredSession) return false
    return (
      restoredSession.q === (urlSearch.q ?? '') &&
      restoredSession.source === activeSource &&
      Array.isArray(restoredSession.searchState?.models)
    )
  }, [restoredSession, urlSearch.q, activeSource])

  useEffect(() => {
    if (!sessionRestored) return
    const payload = JSON.parse(sessionStorage.getItem(HUB_SESSION_KEY) || '{}')
    if (payload.searchState && payload.searchState.models.length) {
      setSearchState({
        models: payload.searchState.models as LiveCatalogModel[],
        total: payload.searchState.total ?? payload.searchState.models.length,
        page: payload.searchState.page ?? 1,
        hasMore: payload.searchState.hasMore ?? false,
      })
      if (payload.sortSelected) setSortSelected(payload.sortSelected)
    }
  }, [sessionRestored])

  // 同步设置页的 HF 镜像域名到搜索服务层
  const hfMirrorBase = useHubSettings((s) => s.hfMirrorBase)
  useEffect(() => {
    setMirrorBase(hfMirrorBase)
  }, [hfMirrorBase])

  const toggleModelExpansion = useCallback((modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }, [])

  // 防抖搜索词
  const [debouncedSearchValue, setDebouncedSearchValue] = useState(searchValue)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchValue])

  const isLiveSearch = debouncedSearchValue.trim().length > 0

  // 实时三源搜索
  useEffect(() => {
    if (sessionRestored) return
    if (!isLiveSearch) {
      setSearchState({ models: [], total: 0, page: 0, hasMore: false })
      setSearchError(null)
      setLiveSearching(false)
      return
    }
    let cancelled = false
    setLiveSearching(true)
    setSearchError(null)
    setSearchTimedOut(false)
    withTimeout(
      searchModelsPage(activeSource, debouncedSearchValue.trim(), 1),
      SEARCH_TIMEOUT_MS
    )
      .then((result) => {
        if (cancelled) return
        setSearchState({
          models: result.models.map((m) =>
            searchModelToCatalogModel(activeSource, m)
          ),
          total: result.total,
          page: result.page,
          hasMore: result.hasMore,
        })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Live search failed:', err)
        // 区分网络超时与普通失败,失败提示条据此展示对应文案
        const isTimeout = (err as { name?: string } | null)?.name === 'TimeoutError'
        setSearchTimedOut(isTimeout)
        setSearchError(
          isTimeout ? 'timeout' : err instanceof Error ? err.message : String(err)
        )
        setSearchState({ models: [], total: 0, page: 0, hasMore: false })
      })
      .finally(() => {
        if (!cancelled) setLiveSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLiveSearch, debouncedSearchValue, activeSource, sessionRestored, searchRetry])

  // 空搜索推荐:跟随当前 tab,失败回退静态目录
  useEffect(() => {
    if (isLiveSearch) return
    let cancelled = false
    setRecommendError(false)
    setRecommendLoading(true)
    withTimeout(fetchRecommended(activeSource), SEARCH_TIMEOUT_MS)
      .then((models) => {
        if (cancelled) return
        setRecommended(
          models.length
            ? models.map((m) => searchModelToCatalogModel(activeSource, m))
            : []
        )
      })
      .catch(() => {
        if (!cancelled) setRecommendError(true)
      })
      .finally(() => {
        if (!cancelled) setRecommendLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLiveSearch, activeSource, recommendRetry])

  // 统一排序:实时搜索结果/推荐列表都应用"最新/最多下载"
  const sortedBase = useMemo(() => {
    let list: CatalogModel[] = isLiveSearch ? searchState.models : recommended
    if (sortSelected === 'mlx') {
      list = list.filter((m) => m.is_mlx)
    } else if (sortSelected === 'gguf') {
      list = list.filter((m) => !m.is_mlx)
    }
    if (sortSelected === 'most-downloaded') {
      return [...list].sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    }
    return [...list].sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )
  }, [isLiveSearch, searchState.models, recommended, sortSelected])

  const filteredModels = useMemo(() => {
    // Speculative draft companions (mtp/eagle3/dflash/dspark) are draft models,
    // not standalone variants — move them out of `quants` (so they don't show
    // as downloadable) into `specQuants`, where DownloadButton resolves them
    // against the chosen quant.
    let filtered: CatalogModel[] = sortedBase.map((model) => ({
      ...model,
      quants: model.quants?.filter((q) => !isSpecSidecar(q)),
      specQuants: model.quants?.filter((q) => isSpecSidecar(q)),
    }))
    // Apply downloaded filter
    if (showOnlyDownloaded) {
      filtered = filtered
        ?.map((model) => ({
          ...model,
          quants: model.quants?.filter((variant) => {
            const isLlamaCppDownloaded = useModelProvider
              .getState()
              .getProviderByName('llamacpp')
              ?.models.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id ===
                    `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )

            const isMlxDownloaded = useModelProvider
              .getState()
              .getProviderByName('mlx')
              ?.models.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id ===
                    `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )

            return isLlamaCppDownloaded || isMlxDownloaded
          }),
        }))
        .filter((model) => (model.quants?.length ?? 0) > 0)
    }
    return filtered
  }, [sortedBase, showOnlyDownloaded])

  // Dynamic estimate size based on model state
  const estimateSize = useCallback(
    (index: number) => {
      const model = filteredModels[index]
      if (!model) return 100
      const baseHeight = 95
      const variantHeight = 36
      const expanded = expandedModels[model.model_name]
      return expanded && (model.quants?.length ?? 0) > 1
        ? baseHeight + (model.quants?.length ?? 0) * variantHeight
        : baseHeight
    },
    [expandedModels, filteredModels]
  )

  // The virtualizer - only enable when we have models
  const rowVirtualizer = useVirtualizer(
    filteredModels.length > 0
      ? {
          count: filteredModels.length,
          getScrollElement: () => parentRef.current,
          estimateSize,
          overscan: 8,
          measureElement: (el: HTMLElement) =>
            el.getBoundingClientRect().height,
        }
      : { count: 0, getScrollElement: () => null, estimateSize: () => 0 }
  )

  // 语义锚点滚动记忆恢复。为避免"先看到顶部再跳变"的闪屏,分成两步:
  //   ① useLayoutEffect 数据一就绪就【立即】落到目标附近(首帧就不在顶部);
  //   ② 总高稳定后【精调】到同一模型的精确位置(幅度小、无感知)。
  // 优先按"模型身份(repoId)"定位,内容变化也不受影响;物理索引/像素兜底。
  const anchorId =
    (restoredSession?.anchorId as string | undefined) ?? undefined
  const anchorTargetIndex = restoredSession?.firstVisibleIndex ?? undefined
  const anchorOffsetInViewport = restoredSession?.offsetInViewport ?? 0
  const anchorScrollTop = restoredSession?.scrollTop ?? 0

  // 立即滚动(useLayoutEffect:paint 前执行,确保用户看到的第一帧就在目标附近)
  useLayoutEffect(() => {
    if (!sessionRestored || !filteredModels.length) return
    if (!parentRef.current) return
    // 先用绝对像素快速到位(同一份快照数据,估算总高下可用);
    if (anchorScrollTop > 0) parentRef.current.scrollTop = anchorScrollTop
  }, [sessionRestored, filteredModels.length])

  useEffect(() => {
    if (!sessionRestored || !restoredSession) return
    if (filteredModels.length === 0) return
    const restoreExact = () => {
      if (!rowVirtualizer || !parentRef.current) return
      // 锚点 = 被点击的模型:把它放回"点击时它在视口里的位置"。
      let idx = -1
      if (anchorId) {
        idx = filteredModels.findIndex(
          (m) => (m as Partial<LiveCatalogModel>).repoId === anchorId
        )
      }
      if (idx >= 0) {
        const off = rowVirtualizer.getOffsetForIndex?.(idx)?.[0]
        const wanted =
          (typeof off === 'number' && Number.isFinite(off) ? off : 0) +
          anchorOffsetInViewport
        if (wanted > 0) parentRef.current.scrollTop = wanted
        return
      }
      // 兜底:物理索引 + 偏移
      if (anchorTargetIndex != null) {
        const off = rowVirtualizer.getOffsetForIndex?.(anchorTargetIndex)?.[0]
        if (
          typeof off === 'number' &&
          Number.isFinite(off) &&
          parentRef.current
        ) {
          parentRef.current.scrollTop = off + anchorOffsetInViewport
          return
        }
      }
      if (anchorScrollTop > 0 && parentRef.current) {
        parentRef.current.scrollTop = anchorScrollTop
      }
    }

    // 就绪信号:等总高连续两帧稳定(测量完成)再精调;80ms 轮询。
    let lastH = -1
    let stable = 0
    const interval = setInterval(() => {
      const h = rowVirtualizer.getTotalSize()
      if (h > 0 && h === lastH) {
        stable += 1
        if (stable >= 2) {
          clearInterval(interval)
          restoreExact()
        }
      } else {
        lastH = h
        stable = 0
      }
    }, 80)
    const hard = setTimeout(restoreExact, 1200)
    return () => {
      clearInterval(interval)
      clearTimeout(hard)
    }
  }, [sessionRestored, restoredSession, filteredModels, rowVirtualizer])

  // Reset initial load state after data loads or on filter change
  useEffect(() => {
    if (!isInitialLoad) return

    const timer = setTimeout(() => setIsInitialLoad(false), 150)
    return () => clearTimeout(timer)
  }, [isInitialLoad, filteredModels.length])

  // 滚动到底部点"加载更多":追加下一页(去重)
  const loadMore = useCallback(async () => {
    if (!isLiveSearch || searchState.page === 0 || !searchState.hasMore) return
    setLoadingMore(true)
    try {
      const result = await searchModelsPage(
        activeSource,
        debouncedSearchValue.trim(),
        searchState.page + 1
      )
      setSearchState((prev) => {
        const known = new Set(prev.models.map((m) => m.repoId))
        const appended = result.models
          .map((m) => searchModelToCatalogModel(activeSource, m))
          .filter((m) => !known.has(m.repoId))
        return {
          models: [...prev.models, ...appended],
          total: result.total,
          page: result.page,
          hasMore: result.hasMore,
        }
      })
    } catch (err) {
      console.error('Load more failed:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [isLiveSearch, searchState, activeSource, debouncedSearchValue])

  const switchSource = useCallback(
    (source: SearchSource) => {
      setActiveSource(source)
      setSearchError(null)
      setSearchTimedOut(false)
      setSearchState({ models: [], total: 0, page: 0, hasMore: false })
      // 立即清空旧源数据并进入加载态:推荐场景走推荐骨架,搜索场景走搜索骨架
      setRecommended([])
      if (searchValue.trim().length > 0) {
        setLiveSearching(true)
      } else {
        setRecommendLoading(true)
      }
      navigate({
        replace: true,
        search: { ...urlSearch, source, q: searchValue || undefined },
      })
    },
    [navigate, urlSearch, searchValue]
  )

  // 重试:搜索失败→重跑当前搜索;推荐失败→重拉推荐列表
  const retry = useCallback(() => {
    if (isLiveSearch) {
      setSearchError(null)
      setSearchTimedOut(false)
      setLiveSearching(true)
      setSearchRetry((n) => n + 1)
    } else {
      setRecommendError(false)
      setRecommendLoading(true)
      setRecommendRetry((n) => n + 1)
    }
  }, [isLiveSearch])

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value)
    navigate({
      replace: true,
      search: { ...urlSearch, q: e.target.value || undefined },
    })
  }

  const isRecommendedModel = useCallback((modelId: string) => {
    return (extractModelName(modelId)?.toLowerCase() ===
      'jan-nano-gguf') as boolean
  }, [])

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

  const saveHubSession = useCallback(
    (
      scrollTop: number,
      anchorId?: string | null,
      offsetRatio?: number,
      firstVisibleIndex?: number | null,
      offsetInViewport?: number
    ) => {
      try {
        const payload = JSON.parse(
          sessionStorage.getItem(HUB_SESSION_KEY) || '{}'
        )
        sessionStorage.setItem(
          HUB_SESSION_KEY,
          JSON.stringify({
            ...payload,
            q: searchValue,
            source: activeSource,
            sortSelected,
            scrollTop,
            // 语义锚点:视口首个可见模型的 repoId + 该行在视口内的比例(0~1)。
            // 内容变化(排序/过滤/加载更多/展开)时仍能定位到"同一个模型",
            // 这是记忆滚动最稳的方式。以下为兜底物理索引/像素。
            anchorId: anchorId ?? payload.anchorId,
            offsetRatio:
              offsetRatio != null ? offsetRatio : payload.offsetRatio,
            firstVisibleIndex:
              firstVisibleIndex != null
                ? firstVisibleIndex
                : payload.firstVisibleIndex,
            offsetInViewport:
              offsetInViewport != null
                ? offsetInViewport
                : payload.offsetInViewport,
            searchState,
            total: searchState.total,
          })
        )
      } catch {
        // 保存失败不影响正常导航
      }
    },
    [searchValue, activeSource, sortSelected, searchState]
  )

  const onOpenDetail = useCallback(
    (model: CatalogModel) => {
      const live = model as Partial<LiveCatalogModel>
      const isHfRepo = model.model_name.includes('/')
      const name = model.model_name
      // 语义锚点滚动记忆:锚点 = 【用户点击的那个模型】。返回时把它放回
      // "点击时它在视口里的位置",最符合直觉(我点开哪个,回来还看到它)。
      const scrollTop = parentRef.current?.scrollTop ?? 0
      const clickedRepoId = (model as Partial<LiveCatalogModel>).repoId ?? null
      let anchorIdx: number | null = null
      if (clickedRepoId) {
        anchorIdx = filteredModels.findIndex(
          (m) => (m as Partial<LiveCatalogModel>).repoId === clickedRepoId
        )
      }
      let anchorOffsetInViewport = 0
      if (anchorIdx != null) {
        const it = rowVirtualizer
          ?.getVirtualItems?.()
          .find((v) => v.index === anchorIdx)
        if (it) anchorOffsetInViewport = Math.max(0, scrollTop - it.start)
      }
      // 偏移比例字段保留兼容旧数据;主要用 clickedRepoId + 视口内偏移
      saveHubSession(
        scrollTop,
        clickedRepoId,
        0,
        anchorIdx,
        anchorOffsetInViewport
      )
      navigate({
        to: route.hub.model,
        params: {
          modelId: isHfRepo ? name.split('/').pop()! : name,
        },
        search: {
          ...(isHfRepo ? { repo: name } : {}),
          ...(live.source ? { source: live.source } : {}),
        },
      })
    },
    [navigate, saveHubSession, rowVirtualizer, filteredModels]
  )

  const hubCardCtx: HubCardCtx = useMemo(
    () => ({
      handleUseModel,
      toggleModelExpansion,
      isRecommendedModel,
      onOpenDetail,
    }),
    [handleUseModel, toggleModelExpansion, isRecommendedModel, onOpenDetail]
  )

  const renderFilter = () => {
    return (
      <>
        {/* Sort dropdown - always visible */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {
                sortOptions.find((option) => option.value === sortSelected)
                  ?.name
              }
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end">
            {sortOptions.map((option) => (
              <DropdownMenuItem
                className={cn(
                  'cursor-pointer my-0.5',
                  sortSelected === option.value && 'bg-secondary'
                )}
                key={option.value}
                onClick={() => {
                  setIsInitialLoad(true)
                  setSortSelected(option.value)
                }}
              >
                {option.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2">
          <Switch
            checked={showOnlyDownloaded}
            onCheckedChange={(checked) => {
              setIsInitialLoad(true)
              setShowOnlyDownloaded(checked)
            }}
          />
          <span className="text-xs text-foreground font-medium whitespace-nowrap">
            {t('hub:downloaded')}
          </span>
        </div>
      </>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <div className="flex flex-col h-full w-full ">
        <HeaderPage>
          <div
            className={cn(
              'pr-3 py-3  h-10 w-full flex items-center justify-between relative z-20',
              !IS_MACOS && 'pr-30'
            )}
          >
            <div className="flex items-center gap-2 w-full">
              {liveSearching ? (
                <Loader className="shrink-0 size-4 animate-spin text-muted-foreground" />
              ) : (
                <IconSearch
                  className="shrink-0 text-muted-foreground"
                  size={14}
                />
              )}
              <input
                placeholder={t('hub:searchPlaceholder')}
                value={searchValue}
                onChange={handleSearchChange}
                className="w-full focus:outline-none"
              />
            </div>
            <div className="sm:flex items-center gap-2 shrink-0 hidden">
              {renderFilter()}
            </div>
          </div>
        </HeaderPage>
        <div
          ref={parentRef}
          className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto! first-step-setup-local-provider"
        >
          <div className="flex flex-col h-full justify-between gap-4 gap-y-3 w-full md:w-4/5 xl:w-4/6 mx-auto">
            {/* 三源切换 tab */}
            <div className="flex items-center gap-1.5 w-fit">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => switchSource(opt.value)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer',
                    activeSource === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:bg-secondary'
                  )}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>

            {/* 搜索计数:搜索到 X 个 · 已加载 Y 个(仅在有结果/已结束时显示,避免加载中误显示 0) */}
            {isLiveSearch && !searchError && !liveSearching && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {t('hub:searchFound', { total: searchState.total })}
                </span>
                <span>
                  {t('hub:searchLoaded', { loaded: filteredModels.length })}
                </span>
              </div>
            )}

            {/* 搜索/推荐失败提示条:不自动降级,由用户主动重试或切换 */}
            {(searchError || (recommendError && !isLiveSearch)) && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
                <p>
                  {searchTimedOut
                    ? t('hub:networkTimeout')
                    : recommendError && !isLiveSearch
                      ? t('hub:catalogLoadFailed')
                      : activeSource === 'hf'
                        ? t('hub:hfSearchFailed')
                        : t('hub:searchFailed', { reason: searchError })}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="secondary" onClick={retry}>
                    {t('hub:retry')}
                  </Button>
                  {activeSource !== 'hf-mirror' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => switchSource('hf-mirror')}
                    >
                      {t('hub:switchToMirror')}
                    </Button>
                  )}
                  {activeSource !== 'hf' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => switchSource('hf')}
                    >
                      {t('hub:switchToHf')}
                    </Button>
                  )}
                  {activeSource !== 'modelscope' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => switchSource('modelscope')}
                    >
                      {t('hub:switchToModelScope')}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Show skeleton immediately on navigation, then show actual content when loaded */}
            {isInitialLoad ||
            (liveSearching && !filteredModels.length) ||
            (recommendLoading && !filteredModels.length) ? (
              // Skeleton loading state for better perceived performance
              <div className="flex flex-col gap-3 animate-pulse">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="bg-card border border-border rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between gap-x-2">
                      <div className="h-5 bg-muted rounded w-1/3" />
                      <div className="flex items-center gap-3">
                        <div className="h-4 bg-muted rounded w-20" />
                        <div className="h-8 w-8 bg-muted rounded" />
                      </div>
                    </div>
                    <div className="mt-3 h-4 bg-muted rounded w-full" />
                    <div className="mt-2 h-4 bg-muted rounded w-2/3" />
                    <div className="flex items-center gap-4 mt-3">
                      <div className="h-4 bg-muted rounded w-16" />
                      <div className="h-4 bg-muted rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  {liveSearching ? (
                    t('hub:searchingLive', {
                      source: t(
                        SOURCE_OPTIONS.find((o) => o.value === activeSource)
                          ?.labelKey ?? 'hub:sourceHfMirror'
                      ),
                    })
                  ) : searchError || (recommendError && !isLiveSearch) ? null : (
                    t('hub:noModels')
                  )}
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'flex flex-col pb-2 mb-2 transition-opacity duration-200',
                  isPending ? 'opacity-70' : 'opacity-100'
                )}
              >
                <div className="flex items-center gap-2 justify-end sm:hidden">
                  {renderFilter()}
                </div>
                <HubCardContext.Provider value={hubCardCtx}>
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                      const rowModel = filteredModels[virtualItem.index]
                      const rowLive =
                        (rowModel as Partial<LiveCatalogModel>).source != null
                      return (
                        <div
                          key={virtualItem.key}
                          data-index={virtualItem.index}
                          ref={rowVirtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualItem.start}px)`,
                            paddingBottom: 8,
                          }}
                        >
                          <HubModelRow
                            model={rowModel}
                            live={rowLive}
                            isExpanded={!!expandedModels[rowModel.model_name]}
                          />
                        </div>
                      )
                    })}
                  </div>
                  {/* 加载更多按钮 */}
                  {isLiveSearch && searchState.hasMore && (
                    <div className="flex justify-center mt-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={loadMore}
                        disabled={loadingMore}
                      >
                        {loadingMore
                          ? t('hub:loadMoreLoading')
                          : t('hub:loadMore')}
                      </Button>
                    </div>
                  )}
                </HubCardContext.Provider>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
