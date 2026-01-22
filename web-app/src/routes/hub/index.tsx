/* eslint-disable @typescript-eslint/no-explicit-any */
import { useVirtualizer } from '@tanstack/react-virtual'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn } from '@/lib/utils'
import {
  useState,
  useMemo,
  useEffect,
  ChangeEvent,
  useCallback,
  useRef,
} from 'react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { Card, CardItem } from '@/containers/Card'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { extractModelName, extractDescription } from '@/lib/models'
import {
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
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import { Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Fuse from 'fuse.js'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { useShallow } from 'zustand/shallow'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'

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
  const parentRef = useRef(null)
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const serviceHub = useServiceHub()

  const { t } = useTranslation()
  const sortOptions = [
    { value: 'newest', name: t('hub:sortNewest') },
    { value: 'most-downloaded', name: t('hub:sortMostDownloaded') },
  ]
  const searchOptions = useMemo(() => {
    return {
      includeScore: true,
      // Search in `author` and in `tags` array
      keys: ['model_name', 'quants.model_id'],
    }
  }, [])

  const { sources, fetchSources, loading } = useModelSources(
    useShallow((state) => ({
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
  const addModelSourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const toggleModelExpansion = (modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }

  // Sorting functionality
  const sortedModels = useMemo(() => {
    return [...sources].sort((a, b) => {
      if (sortSelected === 'most-downloaded') {
        return (b.downloads || 0) - (a.downloads || 0)
      } else {
        return (
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
        )
      }
    })
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
          quants: model.quants.filter((variant) =>
            useModelProvider
              .getState()
              .getProviderByName('llamacpp')
              ?.models.some((m: { id: string }) => m.id === variant.model_id)
          ),
        }))
        .filter((model) => model.quants.length > 0)
    }
    // Add HuggingFace repo at the beginning if available
    if (huggingFaceRepo) {
      filtered = [huggingFaceRepo, ...filtered]
    }
    return filtered
  }, [
    sortedModels,
    debouncedSearchValue,
    showOnlyDownloaded,
    huggingFaceRepo,
    searchOptions,
  ])

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredModels.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
  })

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

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
              (s) =>
                catalogModel.model_name.trim().split('/').pop() ===
                  s.model_name.trim() &&
                catalogModel.developer.trim() === s.developer?.trim()
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
          model: {
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
        {searchValue.length === 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger>
              <span className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium">
                {
                  sortOptions.find((option) => option.value === sortSelected)
                    ?.name
                }
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              {sortOptions.map((option) => (
                <DropdownMenuItem
                  className={cn(
                    'cursor-pointer my-0.5',
                    sortSelected === option.value && 'bg-main-view-fg/5'
                  )}
                  key={option.value}
                  onClick={() => setSortSelected(option.value)}
                >
                  {option.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="flex items-center gap-2">
          <Switch
            checked={showOnlyDownloaded}
            onCheckedChange={(checked) => {
              setShowOnlyDownloaded(checked)
              if (checked) {
                setHuggingFaceRepo(null)
              } else {
                // Re-trigger HuggingFace search when switching back to "All models"
                fetchHuggingFaceModel(searchValue)
              }
            }}
          />
          <span className="text-xs text-main-view-fg/70 font-medium whitespace-nowrap">
            {t('hub:downloaded')}
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex h-full w-full">
        <div className="flex flex-col h-full w-full ">
          <HeaderPage>
            <div className="pr-4 py-3  h-10 w-full flex items-center justify-between relative z-20">
              <div className="flex items-center gap-2 w-full">
                {isSearching ? (
                  <Loader className="shrink-0 size-4 animate-spin text-main-view-fg/60" />
                ) : (
                  <IconSearch
                    className="shrink-0 text-main-view-fg/60"
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
          <div className="p-4 w-full h-[calc(100%-32px)] !overflow-y-auto first-step-setup-local-provider">
            <div className="flex flex-col h-full justify-between gap-4 gap-y-3 w-full md:w-4/5 mx-auto">
              {loading && !filteredModels.length ? (
                <div className="flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    {t('hub:loadingModels')}
                  </div>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    {t('hub:noModels')}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col pb-2 mb-2 gap-2" ref={parentRef}>
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
                      <div key={virtualItem.key} className="mb-2">
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
                                        filteredModels[virtualItem.index]
                                          .model_name,
                                    },
                                  })
                                }}
                              >
                                <h1
                                  className={cn(
                                    'text-main-view-fg font-medium text-base capitalize  sm:max-w-none',
                                    isRecommendedModel(
                                      filteredModels[virtualItem.index]
                                        .model_name
                                    )
                                      ? 'hub-model-card-step'
                                      : ''
                                  )}
                                  title={
                                    extractModelName(
                                      filteredModels[virtualItem.index]
                                        .model_name
                                    ) || ''
                                  }
                                >
                                  {extractModelName(
                                    filteredModels[virtualItem.index].model_name
                                  ) || ''}
                                </h1>
                              </div>
                              <div className="shrink-0 space-x-3 flex items-center">
                                <span className="text-main-view-fg/70 font-medium text-xs">
                                  {
                                    (
                                      filteredModels[
                                        virtualItem.index
                                      ].quants.find((m) =>
                                        DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
                                          m.model_id.toLowerCase().includes(e)
                                        )
                                      ) ??
                                      filteredModels[virtualItem.index]
                                        .quants?.[0]
                                    )?.file_size
                                  }
                                </span>
                                <ModelInfoHoverCard
                                  model={filteredModels[virtualItem.index]}
                                  defaultModelQuantizations={
                                    DEFAULT_MODEL_QUANTIZATIONS
                                  }
                                  variant={
                                    filteredModels[
                                      virtualItem.index
                                    ].quants.find((m) =>
                                      DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
                                        m.model_id.toLowerCase().includes(e)
                                      )
                                    ) ??
                                    filteredModels[virtualItem.index]
                                      .quants?.[0]
                                  }
                                  isDefaultVariant={true}
                                  modelSupportStatus={modelSupportStatus}
                                  onCheckModelSupport={checkModelSupport}
                                />
                                <DownloadButtonPlaceholder
                                  model={filteredModels[virtualItem.index]}
                                  handleUseModel={handleUseModel}
                                />
                              </div>
                            </div>
                          }
                        >
                          <div className="line-clamp-2 mt-3 text-main-view-fg/60">
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
                            <span className="capitalize text-main-view-fg/80">
                              {t('hub:by')}{' '}
                              {filteredModels[virtualItem.index]?.developer}
                            </span>
                            <div className="flex items-center gap-4 ml-2">
                              <div className="flex items-center gap-1">
                                <IconDownload
                                  size={18}
                                  className="text-main-view-fg/50"
                                  title={t('hub:downloads')}
                                />
                                <span className="text-main-view-fg/80">
                                  {filteredModels[virtualItem.index]
                                    .downloads || 0}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <IconFileCode
                                  size={20}
                                  className="text-main-view-fg/50"
                                  title={t('hub:variants')}
                                />
                                <span className="text-main-view-fg/80">
                                  {filteredModels[virtualItem.index].quants
                                    ?.length || 0}
                                </span>
                              </div>
                              <div className="flex gap-1.5 items-center">
                                {filteredModels[virtualItem.index].num_mmproj >
                                  0 && (
                                  <div className="flex items-center gap-1">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div>
                                            <IconEye
                                              size={17}
                                              className="text-main-view-fg/50"
                                            />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{t('vision')}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                )}
                                {filteredModels[virtualItem.index].tools && (
                                  <div className="flex items-center gap-1">
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div>
                                            <IconTool
                                              size={17}
                                              className="text-main-view-fg/50"
                                            />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{t('tools')}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                )}
                              </div>
                              {filteredModels[virtualItem.index].quants.length >
                                1 && (
                                <div className="flex items-center gap-2 hub-show-variants-step">
                                  <Switch
                                    checked={
                                      !!expandedModels[
                                        filteredModels[virtualItem.index]
                                          .model_name
                                      ]
                                    }
                                    onCheckedChange={() =>
                                      toggleModelExpansion(
                                        filteredModels[virtualItem.index]
                                          .model_name
                                      )
                                    }
                                  />
                                  <p className="text-main-view-fg/70">
                                    {t('hub:showVariants')}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                          {expandedModels[
                            filteredModels[virtualItem.index].model_name
                          ] &&
                            filteredModels[virtualItem.index].quants.length >
                              0 && (
                              <div className="mt-5">
                                {filteredModels[virtualItem.index].quants.map(
                                  (variant) => (
                                    <CardItem
                                      key={variant.model_id}
                                      title={
                                        <>
                                          <div className="flex items-center gap-1">
                                            <span className="mr-2">
                                              {variant.model_id}
                                            </span>
                                            {filteredModels[virtualItem.index]
                                              .num_mmproj > 0 && (
                                              <div className="flex items-center gap-1">
                                                <TooltipProvider>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <div>
                                                        <IconEye
                                                          size={17}
                                                          className="text-main-view-fg/50"
                                                        />
                                                      </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                      <p>{t('vision')}</p>
                                                    </TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                              </div>
                                            )}
                                            {filteredModels[virtualItem.index]
                                              .tools && (
                                              <div className="flex items-center gap-1">
                                                <TooltipProvider>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <div>
                                                        <IconTool
                                                          size={17}
                                                          className="text-main-view-fg/50"
                                                        />
                                                      </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                      <p>{t('tools')}</p>
                                                    </TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                              </div>
                                            )}
                                          </div>
                                        </>
                                      }
                                      actions={
                                        <div className="flex items-center gap-2">
                                          <p className="text-main-view-fg/70 font-medium text-xs">
                                            {variant.file_size}
                                          </p>
                                          <ModelInfoHoverCard
                                            model={
                                              filteredModels[virtualItem.index]
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
                                          <ModelDownloadAction
                                            variant={variant}
                                            model={
                                              filteredModels[virtualItem.index]
                                            }
                                          />
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
    </>
  )
}
