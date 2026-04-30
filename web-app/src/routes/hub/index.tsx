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
import {
  extractModelName,
  extractDescription,
  getTotalDownloadFileSize,
  getMlxTotalFileSize,
} from '@/lib/models'
import { useResolvedRecommendedModels } from '@/hooks/useResolvedRecommendedModels'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconFileCode,
  IconEye,
  IconSearch,
  IconTool,
} from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RecommendedModelChip } from '@/components/RecommendedModelChip'
import { chipVariantForRecommendedDescriptionKey } from '@/constants/recommendedModelChip'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import HeaderPage from '@/containers/HeaderPage'
import { ChevronsUpDown, Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Fuse from 'fuse.js'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { useShallow } from 'zustand/shallow'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import { MlxModelDownloadAction } from '@/containers/MlxModelDownloadAction'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'

type SearchParams = {
  repo: string
  engine?: 'mlx' | 'gguf'
}

function pickDefaultQuant(model: CatalogModel) {
  return (
    model.quants?.find((m) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
        m.model_id.toLowerCase().includes(e)
      )
    ) ?? model.quants?.[0]
  )
}

function isJanCatalogModel(model: CatalogModel) {
  const normalizedName = model.model_name.toLowerCase()
  const normalizedDeveloper = model.developer?.toLowerCase() ?? ''
  const normalizedRepoName =
    extractModelName(model.model_name)?.toLowerCase() ?? ''

  return (
    normalizedDeveloper.includes('janhq') ||
    normalizedName.includes('/jan') ||
    normalizedName.includes('jan-') ||
    normalizedRepoName.startsWith('jan')
  )
}

export const Route = createFileRoute(route.hub.index as any)({
  component: HubContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
    engine:
      search.engine === 'mlx' || search.engine === 'gguf'
        ? search.engine
        : undefined,
  }),
})

function HubContent() {
  const [isPending, startTransition] = useTransition()
  const parentRef = useRef(null)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const serviceHub = useServiceHub()
  const { engine: engineSearchParam } = Route.useSearch()

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
      keys: ['model_name', 'quants.model_id', 'safetensors_files.model_id'],
    }),
    []
  )

  const { sources, fetchSources, loading } = useModelSources(
    useShallow((state) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState(
    engineSearchParam === 'mlx' || engineSearchParam === 'gguf'
      ? engineSearchParam
      : 'newest'
  )
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
  const [enrichedOrphans, setEnrichedOrphans] = useState<
    Record<string, CatalogModel>
  >({})
  const enrichedOrphansFetchedRef = useRef<Set<string>>(new Set())

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

  const recommendedItems = useResolvedRecommendedModels(sources)

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
      const providerState = useModelProvider.getState()
      const llamacppModels =
        providerState.getProviderByName('llamacpp')?.models ?? []
      const mlxModels = providerState.getProviderByName('mlx')?.models ?? []

      const matchedLlamacppIds = new Set<string>()
      const matchedMlxIds = new Set<string>()

      // MlxModelDownloadAction uses its own sanitize that preserves dots,
      // unlike the utils version which replaces dots with underscores.
      const sanitizeMlxId = (id: string) =>
        id.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_./]/g, '')

      filtered = filtered
        .filter((model) => {
          if (model.is_mlx) {
            const modelName =
              model.model_name.split('/').pop() ?? model.model_name
            const mlxModelId = sanitizeMlxId(modelName)
            const match = mlxModels.find(
              (m: { id: string }) =>
                m.id === mlxModelId ||
                m.id === `${model.developer}/${mlxModelId}`
            )
            if (match) {
              matchedMlxIds.add(match.id)
              return true
            }
            return false
          }

          const hasDownloaded = model.quants?.some((variant) => {
            const llamaMatch = llamacppModels.find(
              (m: { id: string }) =>
                m.id === variant.model_id ||
                m.id ===
                  `${model.developer}/${sanitizeModelId(variant.model_id)}`
            )
            if (llamaMatch) matchedLlamacppIds.add(llamaMatch.id)

            const mlxMatch = mlxModels.find(
              (m: { id: string }) =>
                m.id === variant.model_id ||
                m.id ===
                  `${model.developer}/${sanitizeModelId(variant.model_id)}`
            )
            if (mlxMatch) matchedMlxIds.add(mlxMatch.id)

            return !!llamaMatch || !!mlxMatch
          })
          return hasDownloaded
        })
        .map((model) => {
          if (model.is_mlx) return model
          return {
            ...model,
            quants: model.quants?.filter((variant) => {
              const isLlamaCppDownloaded = llamacppModels.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id ===
                    `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )
              const isMlxDownloaded = mlxModels.some(
                (m: { id: string }) =>
                  m.id === variant.model_id ||
                  m.id ===
                    `${model.developer}/${sanitizeModelId(variant.model_id)}`
              )
              return isLlamaCppDownloaded || isMlxDownloaded
            }),
          }
        })

      // Try to find a catalog entry matching an orphan model ID.
      const findCatalogEntry = (modelId: string) =>
        sources.find(
          (s) =>
            s.model_name === modelId ||
            s.model_name.split('/').pop() === modelId
        )

      const buildOrphanEntry = (
        modelId: string,
        isMlx: boolean
      ): CatalogModel => {
        if (enrichedOrphans[modelId]) {
          return {
            ...enrichedOrphans[modelId],
            ...(isMlx ? { is_mlx: true } : {}),
          }
        }
        const parts = modelId.split('/')
        const developer = parts.length > 1 ? parts[0] : undefined
        return {
          model_name: modelId,
          description: '',
          developer,
          downloads: 0,
          ...(isMlx
            ? { is_mlx: true }
            : {
                quants: [{ model_id: modelId, path: '', file_size: '' }],
              }),
        }
      }

      // Add locally-downloaded models not present in the catalog
      // Skip embedding models (e.g. Sentence-Transformers) as they are auxiliary
      if (sortSelected !== 'mlx') {
        const orphanLlamacpp = llamacppModels.filter(
          (m: { id: string; embedding?: boolean }) =>
            !matchedLlamacppIds.has(m.id) && !m.embedding
        )
        for (const m of orphanLlamacpp) {
          const catalogMatch = findCatalogEntry(m.id as string)
          filtered.push(catalogMatch ?? buildOrphanEntry(m.id as string, false))
        }
      }

      if (sortSelected !== 'gguf') {
        const orphanMlx = mlxModels.filter(
          (m: { id: string; embedding?: boolean }) =>
            !matchedMlxIds.has(m.id) && !m.embedding
        )
        for (const m of orphanMlx) {
          const catalogMatch = findCatalogEntry(m.id as string)
          filtered.push(
            catalogMatch
              ? { ...catalogMatch, is_mlx: true }
              : buildOrphanEntry(m.id as string, true)
          )
        }
      }
    }
    // Add HuggingFace repo at the beginning if available.
    // Respect the active engine filter so that MLX/GGUF chips don't leak through.
    if (huggingFaceRepo) {
      const matchesEngineFilter =
        sortSelected === 'mlx'
          ? huggingFaceRepo.is_mlx === true
          : sortSelected === 'gguf'
            ? huggingFaceRepo.is_mlx !== true
            : true
      if (matchesEngineFilter) {
        filtered = [huggingFaceRepo, ...filtered]
      }
    }
    return filtered.filter((model) => !isJanCatalogModel(model))
  }, [
    sortedModels,
    debouncedSearchValue,
    showOnlyDownloaded,
    huggingFaceRepo,
    searchOptions,
    sortSelected,
    sources,
    enrichedOrphans,
  ])

  // Collect orphan model IDs that need HuggingFace enrichment
  const orphanIdsToEnrich = useMemo(() => {
    if (!showOnlyDownloaded) return []
    return filteredModels
      .filter(
        (m) => !m.downloads && !m.description && !enrichedOrphans[m.model_name]
      )
      .map((m) => ({ id: m.model_name, isMlx: !!m.is_mlx }))
  }, [filteredModels, showOnlyDownloaded, enrichedOrphans])

  // Fetch HuggingFace data for orphan models
  useEffect(() => {
    if (!orphanIdsToEnrich.length) return

    for (const { id, isMlx } of orphanIdsToEnrich) {
      if (enrichedOrphansFetchedRef.current.has(id)) continue
      enrichedOrphansFetchedRef.current.add(id)

      const repoId = id.includes('/') ? id : isMlx ? `mlx-community/${id}` : id

      serviceHub
        .models()
        .fetchHuggingFaceRepo(repoId, huggingfaceToken)
        .then((repo) => {
          if (!repo) return
          const catalog = serviceHub.models().convertHfRepoToCatalogModel(repo)
          setEnrichedOrphans((prev) => ({ ...prev, [id]: catalog }))
        })
        .catch(() => {})
    }
  }, [orphanIdsToEnrich, serviceHub, huggingfaceToken])

  const showRecommendedBlock =
    debouncedSearchValue.length === 0 && !showOnlyDownloaded

  //* Каталог рендерится всегда: при поиске/фильтре «скачанные» — сам по себе, иначе под блоком Recommended
  const virtualListModels = useMemo(() => {
    return filteredModels
  }, [filteredModels])

  // Dynamic estimate size based on model state
  const estimateSize = useCallback(
    (index: number) => {
      const model = virtualListModels[index]
      if (!model) return 100
      // Base height + variants height if expanded
      const baseHeight = 95
      const variantHeight = 36
      const expanded = expandedModels[model.model_name]
      return expanded && (model.quants?.length ?? 0) > 1
        ? baseHeight + (model.quants?.length ?? 0) * variantHeight
        : baseHeight
    },
    [expandedModels, virtualListModels]
  )

  // The virtualizer - only enable when we have models
  const rowVirtualizer = useVirtualizer(
    virtualListModels.length > 0
      ? {
          count: virtualListModels.length,
          getScrollElement: () => parentRef.current,
          estimateSize,
          overscan: 8,
          measureElement: (el: HTMLElement) =>
            el.getBoundingClientRect().height,
        }
      : { count: 0, getScrollElement: () => null, estimateSize: () => 0 }
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

  const fetchHuggingFaceModel = async (searchValue: string) => {
    const normalizedSearchValue = searchValue.trim()

    if (normalizedSearchValue.length < 3) {
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
          .fetchHuggingFaceRepo(normalizedSearchValue, huggingfaceToken)
        if (repoInfo) {
          const catalogModel = serviceHub
            .models()
            .convertHfRepoToCatalogModel(repoInfo)
          if (
            !sources.some(
              (s) =>
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
            <div className="flex items-center gap-2 w-full min-w-0">
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
                autoComplete="off"
                className="hub-models-search-input w-full min-w-0 flex-1 bg-transparent bg-clip-padding text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none animate-none transition-none"
              />
            </div>
            <div className="sm:flex items-center gap-2 shrink-0 hidden">
              {renderFilter()}
            </div>
          </div>
        </HeaderPage>
        <div
          ref={parentRef}
          className="p-4 w-full h-[calc(100%-60px)] overflow-y-auto!"
        >
          <div className="flex flex-col h-full justify-between gap-4 w-full md:w-4/5 xl:w-4/6 mx-auto">
            {/* Recommended сверху со своим разделителем, затем блок «All Models» с таким же разделителем, затем каталог */}
            {showRecommendedBlock && (
              <section className="shrink-0 border-b border-border pb-4">
                <h2 className="text-sm font-medium mb-3 text-muted-foreground">
                  {t('hub:recTitle')}
                </h2>
                <div className="flex flex-col gap-1">
                  {recommendedItems.map(({ rec, model }) => {
                    const goToModel = () => {
                      navigate({
                        to: route.hub.model,
                        params: {
                          modelId: model ? model.model_name : rec.modelName,
                        },
                      })
                    }
                    const recChip = (
                      <RecommendedModelChip
                        variant={chipVariantForRecommendedDescriptionKey(
                          rec.descriptionKey
                        )}
                        title={t(rec.descriptionKey)}
                      >
                        {t(rec.descriptionKey)}
                      </RecommendedModelChip>
                    )
                    const defaultVariant = model
                      ? pickDefaultQuant(model)
                      : undefined
                    const downloadSize = model
                      ? model.is_mlx
                        ? getMlxTotalFileSize(model)
                        : getTotalDownloadFileSize(model, defaultVariant)
                      : undefined
                    return model ? (
                      <div key={`${rec.modelName}-${rec.descriptionKey}`}>
                        <Card
                          header={
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                              <div
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
                                onClick={goToModel}
                              >
                                <h1
                                  className={cn(
                                    'min-w-0 shrink truncate text-foreground font-medium text-base capitalize',
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
                                {recChip}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 justify-end shrink-0">
                                <span className="text-muted-foreground font-medium text-xs whitespace-nowrap">
                                  {downloadSize}
                                </span>
                                <ModelInfoHoverCard
                                  model={model}
                                  defaultModelQuantizations={
                                    DEFAULT_MODEL_QUANTIZATIONS
                                  }
                                  variant={defaultVariant}
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
                          <div
                            className="line-clamp-2 mt-3 text-muted-foreground leading-normal cursor-pointer"
                            onClick={(e) => {
                              if (!(e.target as HTMLElement).closest('a')) {
                                goToModel()
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                goToModel()
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
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
                                extractDescription(model?.description) || ''
                              }
                            />
                          </div>
                          <div
                            className="flex items-center gap-2 mt-2 cursor-pointer"
                            onClick={goToModel}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                goToModel()
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <span className="capitalize text-foreground">
                              {t('hub:by')} {model?.developer}
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
                                {model.quants?.map((variant) => (
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
                                          {getTotalDownloadFileSize(
                                            model,
                                            variant
                                          )}
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
                    ) : (
                      <div key={`${rec.modelName}-${rec.descriptionKey}`}>
                        <Card
                          header={
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                              <div
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
                                onClick={goToModel}
                              >
                                <h1 className="min-w-0 shrink truncate text-foreground font-medium text-base capitalize">
                                  {extractModelName(rec.modelName) ||
                                    rec.modelName}
                                </h1>
                                {recChip}
                              </div>
                            </div>
                          }
                        >
                          <div
                            className="mt-3 text-muted-foreground text-sm cursor-pointer"
                            onClick={goToModel}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                goToModel()
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            {t(rec.descriptionKey)}
                          </div>
                          <p
                            className="mt-2 text-xs text-muted-foreground cursor-pointer"
                            onClick={goToModel}
                          >
                            {t('hub:by')} {rec.modelName.split('/')[0]}
                          </p>
                        </Card>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
            {showRecommendedBlock && (
              <section className="shrink-0">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {t('hub:allModelsTitle')}
                </h2>
              </section>
            )}
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
            ) : filteredModels.length === 0 && !showRecommendedBlock ? (
              <div className="flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  {t('hub:noModels')}
                </div>
              </div>
            ) : virtualListModels.length === 0 ? null : (
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
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => (
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
                        //* Симметрия вокруг разделителя: раньше был только paddingBottom — зазор визуально смещался вниз
                        paddingTop: 4,
                        paddingBottom: 0,
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
                                    modelId:
                                      virtualListModels[virtualItem.index]
                                        .model_name,
                                  },
                                })
                              }}
                            >
                              <h1
                                className={cn(
                                  'text-foreground font-medium text-base capitalize sm:max-w-none',
                                  isRecommendedModel(
                                    virtualListModels[virtualItem.index]
                                      .model_name
                                  )
                                    ? 'hub-model-card-step'
                                    : ''
                                )}
                                title={
                                  extractModelName(
                                    virtualListModels[virtualItem.index]
                                      .model_name
                                  ) || ''
                                }
                              >
                                {extractModelName(
                                  virtualListModels[virtualItem.index]
                                    .model_name
                                ) || ''}
                              </h1>
                            </div>
                            <div className="shrink-0 space-x-3 flex items-center">
                              <span className="text-muted-foreground font-medium text-xs">
                                {virtualListModels[virtualItem.index].is_mlx
                                  ? getMlxTotalFileSize(
                                      virtualListModels[virtualItem.index]
                                    )
                                  : getTotalDownloadFileSize(
                                      virtualListModels[virtualItem.index],
                                      pickDefaultQuant(
                                        virtualListModels[virtualItem.index]
                                      )
                                    )}
                              </span>
                              <ModelInfoHoverCard
                                model={virtualListModels[virtualItem.index]}
                                defaultModelQuantizations={
                                  DEFAULT_MODEL_QUANTIZATIONS
                                }
                                variant={pickDefaultQuant(
                                  virtualListModels[virtualItem.index]
                                )}
                                isDefaultVariant={true}
                                modelSupportStatus={modelSupportStatus}
                                onCheckModelSupport={checkModelSupport}
                              />
                              {virtualListModels[virtualItem.index].is_mlx ? (
                                <MlxModelDownloadAction
                                  model={virtualListModels[virtualItem.index]}
                                />
                              ) : (
                                <DownloadButtonPlaceholder
                                  model={virtualListModels[virtualItem.index]}
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
                                virtualListModels[virtualItem.index]
                                  ?.description
                              ) || ''
                            }
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {virtualListModels[virtualItem.index]?.developer && (
                            <span className="capitalize text-foreground">
                              {t('hub:by')}{' '}
                              {virtualListModels[virtualItem.index].developer}
                            </span>
                          )}
                          <div className="flex items-center gap-4 ml-2">
                            {(virtualListModels[virtualItem.index].downloads ??
                              0) > 0 && (
                              <div className="flex items-center gap-1">
                                <IconDownload
                                  size={18}
                                  className="text-muted-foreground"
                                  title={t('hub:downloads')}
                                />
                                <span className="text-foreground">
                                  {
                                    virtualListModels[virtualItem.index]
                                      .downloads
                                  }
                                </span>
                              </div>
                            )}
                            {!virtualListModels[virtualItem.index].is_mlx && (
                              <div className="flex items-center gap-1">
                                <IconFileCode
                                  size={20}
                                  className="text-muted-foreground"
                                  title={t('hub:variants')}
                                />
                                <span className="text-foreground">
                                  {virtualListModels[virtualItem.index].quants
                                    ?.length || 0}
                                </span>
                              </div>
                            )}
                            {virtualListModels[virtualItem.index].is_mlx && (
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
                              {(virtualListModels[virtualItem.index]
                                .num_mmproj ?? 0) > 0 && (
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
                              {virtualListModels[virtualItem.index].tools && (
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
                          {(virtualListModels[virtualItem.index].quants
                            ?.length ?? 0) > 1 && (
                            <button
                              className="flex items-center gap-1 hub-show-variants-step ml-auto"
                              onClick={() =>
                                toggleModelExpansion(
                                  virtualListModels[virtualItem.index]
                                    .model_name
                                )
                              }
                            >
                              <span className="text-foreground">
                                {t('hub:showVariants')}
                              </span>
                              {expandedModels[
                                virtualListModels[virtualItem.index].model_name
                              ] ? (
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
                        {expandedModels[
                          virtualListModels[virtualItem.index].model_name
                        ] &&
                          (virtualListModels[virtualItem.index].quants
                            ?.length ?? 0) > 0 && (
                            <div className="mt-5">
                              {virtualListModels[virtualItem.index].quants?.map(
                                (variant) => (
                                  <CardItem
                                    key={variant.model_id}
                                    title={
                                      <>
                                        <div className="flex items-center gap-1">
                                          <span className="mr-2">
                                            {variant.model_id}
                                          </span>
                                          {(virtualListModels[virtualItem.index]
                                            .num_mmproj ?? 0) > 0 && (
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
                                          {virtualListModels[virtualItem.index]
                                            .tools && (
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
                                          {getTotalDownloadFileSize(
                                            virtualListModels[
                                              virtualItem.index
                                            ],
                                            variant
                                          )}
                                        </p>
                                        <ModelInfoHoverCard
                                          model={
                                            virtualListModels[virtualItem.index]
                                          }
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
                                        {virtualListModels[virtualItem.index]
                                          .is_mlx ? (
                                          <MlxModelDownloadAction
                                            model={
                                              virtualListModels[
                                                virtualItem.index
                                              ]
                                            }
                                          />
                                        ) : (
                                          <ModelDownloadAction
                                            variant={variant}
                                            model={
                                              virtualListModels[
                                                virtualItem.index
                                              ]
                                            }
                                          />
                                        )}
                                      </div>
                                    }
                                  />
                                )
                              )}
                            </div>
                          )}
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
