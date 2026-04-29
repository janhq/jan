/* eslint-disable @typescript-eslint/no-explicit-any */
import { useVirtualizer } from '@tanstack/react-virtual'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn, sanitizeModelId } from '@/lib/utils'
import {
  useState,
  useMemo,
  useEffect,
  ChangeEvent,
  useCallback,
  useRef,
  useTransition,
} from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Card, CardItem } from '@/containers/Card'
import { extractModelName, extractDescription } from '@/lib/models'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconFileCode,
  IconEye,
  IconSearch,
  IconRocket,
  IconTool,
  IconBrandSpeedtest,
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
import { Badge } from '@/components/ui/badge'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel, ModelQuant } from '@/services/models/types'
import HeaderPage from '@/containers/HeaderPage'
import { ChevronsUpDown, Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Fuse from 'fuse.js'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { useShallow } from 'zustand/react/shallow'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useModelScore } from '@/hooks/useModelScores'
import { selectBestGgufVariant } from '@/lib/modelQuantization'
import {
  FIT_LEVEL_BADGE_VARIANTS,
  FIT_LEVEL_TRANSLATION_KEYS,
} from '../../utils/scoreUtils'

type SearchParams = {
  repo: string
}

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function HubContent() {
  const [isPending, startTransition] = useTransition()
  const parentRef = useRef(null)
  const huggingfaceToken = useGeneralSetting(
    (state: ReturnType<typeof useGeneralSetting.getState>) =>
      state.huggingfaceToken
  )
  const serviceHub = useServiceHub()

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
  const searchOptions = useMemo(
    () => ({
      includeScore: true,
      // Search in `author` and in `tags` array
      keys: ['model_name', 'quants.model_id'],
    }),
    []
  )

  const { sources, fetchSources, loading } = useModelSources(
    useShallow((state: ReturnType<typeof useModelSources.getState>) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )
  const [isSearching, setIsSearching] = useState(false)
  const [showOnlyDownloaded, setShowOnlyDownloaded] = useState(false)
  const [huggingFaceRepo, setHuggingFaceRepo] = useState<CatalogModel | null>(
    null
  )
  const [modelSupportStatus, setModelSupportStatus] = useState<
    Record<string, 'RED' | 'YELLOW' | 'GREEN' | 'LOADING'>
  >({})
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const addModelSourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const { modelScores, fetchModelScore } = useModelScore(
    useShallow((state) => ({
      modelScores: state.scores,
      fetchModelScore: state.fetchModelScore,
    }))
  )

  const toggleModelExpansion = useCallback((modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }, [])

  // Sorting functionality
  const sortedModels = useMemo(() => {
    let sorted = [...sources]

    // Apply MLX/GGUF filter first (only on Mac)
    if (sortSelected === 'mlx') {
      sorted = sorted.filter((m) => m.is_mlx)
    } else if (sortSelected === 'gguf') {
      sorted = sorted.filter((m) => !m.is_mlx)
    }

    // Apply sorting
    if (sortSelected === 'most-downloaded') {
      return sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    }
    return sorted.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )
  }, [sortSelected, sources])

  // Filtered models (debounced search)
  const [debouncedSearchValue, setDebouncedSearchValue] = useState(searchValue)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchValue])

  const filteredModels = useMemo(() => {
    let filtered = sortedModels
    // Apply search filter
    if (debouncedSearchValue.length) {
      const fuse = new Fuse(filtered, searchOptions)
      // Remove domain from search value (e.g., "huggingface.co/author/model" -> "author/model")
      const cleanedSearchValue = debouncedSearchValue.replace(
        /^https?:\/\/[^/]+\//,
        ''
      )
      filtered = fuse.search(cleanedSearchValue).map((result) => result.item)
    }
    // Apply downloaded filter
    if (showOnlyDownloaded) {
      filtered = filtered
        ?.map((model) => ({
          ...model,
          quants: model.quants?.filter((variant: ModelQuant) => {
            // Check both direct match and with developer prefix (like DownloadButton does)
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
    // Add HuggingFace repo at the beginning if available
    if (huggingFaceRepo) {
      filtered = [huggingFaceRepo, ...filtered]
    }

    return filtered?.map((model) => ({
      ...model,
      score: modelScores[model.model_name],
    }))
  }, [
    sortedModels,
    debouncedSearchValue,
    showOnlyDownloaded,
    huggingFaceRepo,
    searchOptions,
    modelScores,
  ])

  // Dynamic estimate size based on model state
  const estimateSize = useCallback(
    (index: number) => {
      const model = filteredModels[index]
      if (!model) return 100
      // Base height + variants height if expanded
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
  const virtualItems = rowVirtualizer.getVirtualItems()
  // Primitive dep: only changes value when the set of visible rows changes,
  // not on every scroll tick (unlike the virtualItems array reference).
  const visibleIndices = virtualItems.map((v) => v.index).join(',')

  const getRepresentativeVariant = useCallback(
    (model: CatalogModel) =>
      model.is_mlx ? undefined : selectBestGgufVariant(model.quants),
    []
  )

  useEffect(() => {
    // Use startTransition to keep UI responsive during data fetch
    startTransition(() => {
      fetchSources()
    })
  }, [fetchSources])

  // Reset initial load state after data loads or on filter change
  useEffect(() => {
    if (!isInitialLoad) return

    // Hide skeleton after a short delay to show loading state
    const timer = setTimeout(() => setIsInitialLoad(false), 150)
    return () => clearTimeout(timer)
  }, [isInitialLoad, filteredModels.length])

  useEffect(() => {
    virtualItems.forEach((virtualItem) => {
      const model = filteredModels[virtualItem.index]
      if (!model || modelScores[model.model_name]) return
      void fetchModelScore(model)
    })
    // visibleIndices (not virtualItems) is the dep so this only re-runs when
    // the set of visible rows actually changes, not on every scroll event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchModelScore, filteredModels, modelScores, visibleIndices])

  const fetchHuggingFaceModel = async (searchValue: string) => {
    if (
      !searchValue.length ||
      (!searchValue.includes('/') && !searchValue.startsWith('http'))
    ) {
      return
    }

    setIsSearching(true)
    if (addModelSourceTimeoutRef.current) {
      clearTimeout(addModelSourceTimeoutRef.current)
    }

    addModelSourceTimeoutRef.current = setTimeout(async () => {
      try {
        const repoInfo = await serviceHub
          .models()
          .fetchHuggingFaceRepo(searchValue, huggingfaceToken)
        if (repoInfo) {
          const catalogModel = serviceHub
            .models()
            .convertHfRepoToCatalogModel(repoInfo)
          if (
            !sources.some(
              (s: CatalogModel) =>
                catalogModel.model_name.trim().split('/').pop() ===
                  s.model_name.trim() &&
                catalogModel.developer?.trim() === s.developer?.trim()
            )
          ) {
            setHuggingFaceRepo(catalogModel)
          }
        }
      } catch (error) {
        console.error('Error fetching repository info:', error)
      } finally {
        setIsSearching(false)
      }
    }, 500)
  }

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setIsSearching(false)
    setSearchValue(e.target.value)
    setHuggingFaceRepo(null) // Clear previous repo info

    if (!showOnlyDownloaded) {
      fetchHuggingFaceModel(e.target.value)
    }
  }

  const navigate = useNavigate()

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

  const checkModelSupport = useCallback(
    async (variant: any) => {
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
        const supportStatus = await serviceHub
          .models()
          .isModelSupported(modelPath, 8192)

        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: supportStatus,
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

  // Check if we're on the last step
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
              if (checked) {
                setHuggingFaceRepo(null)
              } else {
                // Re-trigger HuggingFace search when switching back to "All models"
                fetchHuggingFaceModel(searchValue)
              }
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
              {isSearching ? (
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
            {/* Show skeleton immediately on navigation, then show actual content when loaded */}
            {isInitialLoad || (loading && !filteredModels.length) ? (
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
                  {t('hub:noModels')}
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
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const model = filteredModels[virtualItem.index]

                    if (!model) {
                      return null
                    }

                    const score = model.score
                    const fitLevel = score?.breakdown?.fit_level

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
                        <Card
                          header={
                            <div className="flex items-center justify-between gap-x-2">
                              <div
                                className="cursor-pointer"
                                onClick={() => {
                                  navigate({
                                    to: route.hub.model,
                                    params: {
                                      modelId: model.model_name,
                                    },
                                  })
                                }}
                              >
                                <h1
                                  className={cn(
                                    'text-foreground font-medium text-base capitalize sm:max-w-none',
                                    isRecommendedModel(model.model_name)
                                      ? 'hub-model-card-step'
                                      : ''
                                  )}
                                  title={
                                    extractModelName(model.model_name) || ''
                                  }
                                >
                                  {extractModelName(model.model_name) || ''}
                                </h1>
                              </div>
                              <div className="shrink-0 space-x-3 flex items-center">
                                <span className="text-muted-foreground font-medium text-xs">
                                  {model.is_mlx
                                    ? model.safetensors_files?.[0]?.file_size
                                    : getRepresentativeVariant(model)
                                        ?.file_size}
                                </span>
                                <div className="gap-2 inline-flex items-center">
                                  <div className="flex items-center gap-1 px-2 py-0.5">
                                    <IconRocket
                                      size={20}
                                      className="text-muted-foreground"
                                      title={t('hub:scoreSummary.token-sec')}
                                    />
                                    <span
                                      className={cn(
                                        'text-xs text-muted-foreground font-medium'
                                      )}
                                    >
                                      {score?.status === 'ready' &&
                                      typeof score.overall === 'number' ? (
                                        score.overall.toFixed(1)
                                      ) : !score ||
                                        score.status === 'loading' ? (
                                        <Loader className="size-3 animate-spin text-muted-foreground" />
                                      ) : (
                                        t('hub:scoreSummary.na')
                                      )}
                                    </span>
                                  </div>
                                  {fitLevel !== undefined && (
                                    <Badge
                                      className="ml-2"
                                      variant={
                                        fitLevel
                                          ? FIT_LEVEL_BADGE_VARIANTS[
                                              fitLevel as keyof typeof FIT_LEVEL_BADGE_VARIANTS
                                            ]
                                          : 'secondary'
                                      }
                                    >
                                      {t(
                                        FIT_LEVEL_TRANSLATION_KEYS[fitLevel] ??
                                          fitLevel
                                      )}
                                    </Badge>
                                  )}
                                </div>
                                <ModelInfoHoverCard
                                  model={model}
                                  defaultModelQuantizations={
                                    DEFAULT_MODEL_QUANTIZATIONS
                                  }
                                  variant={getRepresentativeVariant(model)}
                                  isDefaultVariant={true}
                                  modelSupportStatus={modelSupportStatus}
                                  onCheckModelSupport={checkModelSupport}
                                />
                                {model.is_mlx ? (
                                  <MlxModelDownloadAction model={model} />
                                ) : (
                                  <DownloadButtonPlaceholder
                                    model={model}
                                    handleUseModel={handleUseModel}
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
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                ),
                              }}
                              content={
                                extractDescription(
                                  filteredModels[virtualItem.index]?.description
                                ) || ''
                              }
                            />
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="capitalize text-foreground">
                              {t('hub:by')} {model.developer}
                            </span>
                            <div className="flex items-center gap-4 ml-2">
                              <div className="flex items-center gap-1">
                                <IconDownload
                                  size={18}
                                  className="text-muted-foreground"
                                  title={t('hub:downloads')}
                                />
                                <span className="text-foreground">
                                  {model.downloads || 0}
                                </span>
                              </div>
                              {!model.is_mlx && (
                                <div className="flex items-center gap-1">
                                  <IconFileCode
                                    size={20}
                                    className="text-muted-foreground"
                                    title={t('hub:variants')}
                                  />
                                  <span className="text-foreground">
                                    {model.quants?.length || 0}
                                  </span>
                                </div>
                              )}
                              {modelScores[model.model_name]?.status === 'ready' 
                              && modelScores[model.model_name]?.estimated_tps > 0 && (
                                  <div className="flex items-center gap-1">
                                    <IconBrandSpeedtest
                                      size={20}
                                      className="text-muted-foreground"
                                      title={t('hub:scoreSummary.token-sec')}
                                    />
                                    <span className="text-foreground">
                                      {modelScores[
                                        model.model_name
                                      ]?.estimated_tps?.toFixed(1)}{' '}
                                      tok/sec
                                    </span>
                                  </div>
                                )}
                              {model.is_mlx && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                                      MLX
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>
                                      Requires MLX engine (Apple Silicon only)
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <div className="flex gap-1.5 items-center">
                                {(model.num_mmproj ?? 0) > 0 && (
                                  <div className="flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>
                                          <IconEye
                                            size={17}
                                            className="text-muted-foreground"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{t('vision')}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                )}
                                {model.tools && (
                                  <div className="flex items-center gap-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div>
                                          <IconTool
                                            size={17}
                                            className="text-muted-foreground"
                                          />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{t('tools')}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                )}
                              </div>
                            </div>
                            {(model.quants?.length ?? 0) > 1 && (
                              <button
                                className="flex items-center gap-1 hub-show-variants-step ml-auto"
                                onClick={() =>
                                  toggleModelExpansion(model.model_name)
                                }
                              >
                                <span className="text-foreground">
                                  {t('hub:showVariants')}
                                </span>
                                {expandedModels[model.model_name] ? (
                                  <IconChevronUp
                                    size={18}
                                    className="text-muted-foreground"
                                  />
                                ) : (
                                  <IconChevronDown
                                    size={18}
                                    className="text-muted-foreground"
                                  />
                                )}
                              </button>
                            )}
                          </div>
                          {expandedModels[model.model_name] &&
                            (model.quants?.length ?? 0) > 0 && (
                              <div className="mt-5">
                                {model.quants?.map((variant: ModelQuant) => (
                                  <CardItem
                                    key={variant.model_id}
                                    title={
                                      <>
                                        <div className="flex items-center gap-1">
                                          <span className="mr-2">
                                            {variant.model_id}
                                          </span>
                                          {(model.num_mmproj ?? 0) > 0 && (
                                            <div className="flex items-center gap-1">
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <div>
                                                    <IconEye
                                                      size={17}
                                                      className="text-muted-foreground"
                                                    />
                                                  </div>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                  <p>{t('vision')}</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </div>
                                          )}
                                          {model.tools && (
                                            <div className="flex items-center gap-1">
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <div>
                                                    <IconTool
                                                      size={17}
                                                      className="text-muted-foreground"
                                                    />
                                                  </div>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                  <p>{t('tools')}</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </div>
                                          )}
                                        </div>
                                      </>
                                    }
                                    actions={
                                      <div className="flex items-center gap-2">
                                        <p className="text-muted-foreground font-medium text-xs">
                                          {variant.file_size}
                                        </p>
                                        <ModelInfoHoverCard
                                          model={model}
                                          variant={variant}
                                          defaultModelQuantizations={
                                            DEFAULT_MODEL_QUANTIZATIONS
                                          }
                                          modelSupportStatus={
                                            modelSupportStatus
                                          }
                                          onCheckModelSupport={
                                            checkModelSupport
                                          }
                                        />
                                        {model.is_mlx ? (
                                          <MlxModelDownloadAction
                                            model={model}
                                          />
                                        ) : (
                                          <ModelDownloadAction
                                            variant={variant}
                                            model={model}
                                          />
                                        )}
                                      </div>
                                    }
                                  />
                                ))}
                              </div>
                            )}
                        </Card>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
