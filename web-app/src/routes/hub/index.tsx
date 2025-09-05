/* eslint-disable @typescript-eslint/no-explicit-any */
import { useVirtualizer } from '@tanstack/react-virtual'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn } from '@/lib/utils'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform'
import {
  useState,
  useMemo,
  useEffect,
  ChangeEvent,
  useCallback,
  useRef,
} from 'react'
import { Button } from '@/components/ui/button'
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
import Joyride, { CallBackProps, STATUS } from 'react-joyride'
import { CustomTooltipJoyRide } from '@/containers/CustomeTooltipJoyRide'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { Progress } from '@/components/ui/progress'
import HeaderPage from '@/containers/HeaderPage'
import { Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Fuse from 'fuse.js'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

type ModelProps = {
  model: CatalogModel
}
type SearchParams = {
  repo: string
}
const defaultModelQuantizations = ['iq4_xs', 'q4_k_m']

export const Route = createFileRoute(route.hub.index as any)({
  component: Hub,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function Hub() {
  return (
    <PlatformGuard feature={PlatformFeature.MODEL_HUB}>
      <HubContent />
    </PlatformGuard>
  )
}

function HubContent() {
  const parentRef = useRef(null)
  const { huggingfaceToken } = useGeneralSetting()
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

  const { sources, fetchSources, loading } = useModelSources()

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
  const [joyrideReady, setJoyrideReady] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const addModelSourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const downloadButtonRef = useRef<HTMLButtonElement>(null)
  const hasTriggeredDownload = useRef(false)

  const { getProviderByName } = useModelProvider()
  const llamaProvider = getProviderByName('llamacpp')

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
            llamaProvider?.models.some(
              (m: { id: string }) => m.id === variant.model_id
            )
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
    llamaProvider?.models,
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
        const repoInfo = await serviceHub.models().fetchHuggingFaceRepo(searchValue, huggingfaceToken)
        if (repoInfo) {
          const catalogModel = serviceHub.models().convertHfRepoToCatalogModel(repoInfo)
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

  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()

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
        const supportStatus = await serviceHub.models().isModelSupported(modelPath, 8192)

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

  const DownloadButtonPlaceholder = useMemo(() => {
    return ({ model }: ModelProps) => {
      // Check if this is a HuggingFace repository (no quants)
      if (model.quants.length === 0) {
        return (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                window.open(
                  `https://huggingface.co/${model.model_name}`,
                  '_blank'
                )
              }}
            >
              View on HuggingFace
            </Button>
          </div>
        )
      }

      const quant =
        model.quants.find((e) =>
          defaultModelQuantizations.some((m) =>
            e.model_id.toLowerCase().includes(m)
          )
        ) ?? model.quants[0]
      const modelId = quant?.model_id || model.model_name
      const modelUrl = quant?.path || modelId
      const isDownloading =
        localDownloadingModels.has(modelId) ||
        downloadProcesses.some((e) => e.id === modelId)
      const downloadProgress =
        downloadProcesses.find((e) => e.id === modelId)?.progress || 0
      const isDownloaded = llamaProvider?.models.some(
        (m: { id: string }) => m.id === modelId
      )
      const isRecommended = isRecommendedModel(model.model_name)

      const handleDownload = () => {
        // Immediately set local downloading state
        addLocalDownloadingModel(modelId)
        const mmprojPath = model.mmproj_models?.[0]?.path
        serviceHub.models().pullModelWithMetadata(
          modelId, 
          modelUrl,
          mmprojPath,
          huggingfaceToken
        )
      }

      return (
        <div
          className={cn(
            'flex items-center',
            isRecommended && 'hub-download-button-step'
          )}
        >
          {isDownloading && !isDownloaded && (
            <div className={cn('flex items-center gap-2 w-20')}>
              <Progress value={downloadProgress * 100} />
              <span className="text-xs text-center text-main-view-fg/70">
                {Math.round(downloadProgress * 100)}%
              </span>
            </div>
          )}
          {isDownloaded ? (
            <Button
              size="sm"
              onClick={() => handleUseModel(modelId)}
              data-test-id={`hub-model-${modelId}`}
            >
              {t('hub:use')}
            </Button>
          ) : (
            <Button
              data-test-id={`hub-model-${modelId}`}
              size="sm"
              onClick={handleDownload}
              className={cn(isDownloading && 'hidden')}
              ref={isRecommended ? downloadButtonRef : undefined}
            >
              {t('hub:download')}
            </Button>
          )}
        </div>
      )
    }
  }, [
    localDownloadingModels,
    downloadProcesses,
    llamaProvider?.models,
    isRecommendedModel,
    t,
    addLocalDownloadingModel,
    huggingfaceToken,
    handleUseModel,
    serviceHub,
  ])

  const { step } = useSearch({ from: Route.id })
  const isSetup = step === 'setup_local_provider'

  // Wait for DOM to be ready before starting Joyride
  useEffect(() => {
    if (!loading && filteredModels.length > 0 && isSetup) {
      const timer = setTimeout(() => {
        setJoyrideReady(true)
      }, 100)
      return () => clearTimeout(timer)
    } else {
      setJoyrideReady(false)
    }
  }, [loading, filteredModels.length, isSetup])

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, index } = data

    if (
      status === STATUS.FINISHED &&
      !isDownloading &&
      isLastStep &&
      !hasTriggeredDownload.current
    ) {
      const recommendedModel = filteredModels.find((model) =>
        isRecommendedModel(model.model_name)
      )
      if (recommendedModel && recommendedModel.quants[0]?.model_id) {
        if (downloadButtonRef.current) {
          hasTriggeredDownload.current = true
          downloadButtonRef.current.click()
        }
        return
      }
    }

    if (status === STATUS.FINISHED) {
      navigate({
        to: route.hub.index,
      })
    }

    // Track current step index
    setCurrentStepIndex(index)
  }

  // Check if any model is currently downloading
  const isDownloading =
    localDownloadingModels.size > 0 || downloadProcesses.length > 0

  const steps = [
    {
      target: '.hub-model-card-step',
      title: t('hub:joyride.recommendedModelTitle'),
      disableBeacon: true,
      content: t('hub:joyride.recommendedModelContent'),
    },
    {
      target: '.hub-download-button-step',
      title: isDownloading
        ? t('hub:joyride.downloadInProgressTitle')
        : t('hub:joyride.downloadModelTitle'),
      disableBeacon: true,
      content: isDownloading
        ? t('hub:joyride.downloadInProgressContent')
        : t('hub:joyride.downloadModelContent'),
    },
  ]

  // Check if we're on the last step
  const isLastStep = currentStepIndex === steps.length - 1

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
      <Joyride
        run={joyrideReady}
        floaterProps={{
          hideArrow: true,
        }}
        steps={steps}
        tooltipComponent={CustomTooltipJoyRide}
        spotlightPadding={0}
        continuous={true}
        showSkipButton={!isLastStep}
        hideCloseButton={true}
        spotlightClicks={true}
        disableOverlay={IS_LINUX}
        disableOverlayClose={true}
        callback={handleJoyrideCallback}
        locale={{
          back: t('hub:joyride.back'),
          close: t('hub:joyride.close'),
          last: !isDownloading
            ? t('hub:joyride.lastWithDownload')
            : t('hub:joyride.last'),
          next: t('hub:joyride.next'),
          skip: t('hub:joyride.skip'),
        }}
      />
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
                                        defaultModelQuantizations.some((e) =>
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
                                    defaultModelQuantizations
                                  }
                                  variant={
                                    filteredModels[
                                      virtualItem.index
                                    ].quants.find((m) =>
                                      defaultModelQuantizations.some((e) =>
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
                                />
                              </div>
                            </div>
                          }
                        >
                          <div className="line-clamp-2 mt-3 text-main-view-fg/60">
                            <RenderMarkdown
                              enableRawHtml={true}
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
                                              defaultModelQuantizations
                                            }
                                            modelSupportStatus={
                                              modelSupportStatus
                                            }
                                            onCheckModelSupport={
                                              checkModelSupport
                                            }
                                          />
                                          {(() => {
                                            const isDownloading =
                                              localDownloadingModels.has(
                                                variant.model_id
                                              ) ||
                                              downloadProcesses.some(
                                                (e) => e.id === variant.model_id
                                              )
                                            const downloadProgress =
                                              downloadProcesses.find(
                                                (e) => e.id === variant.model_id
                                              )?.progress || 0
                                            const isDownloaded =
                                              llamaProvider?.models.some(
                                                (m: { id: string }) =>
                                                  m.id === variant.model_id
                                              )

                                            if (isDownloading) {
                                              return (
                                                <>
                                                  <div className="flex items-center gap-2 w-20">
                                                    <Progress
                                                      value={
                                                        downloadProgress * 100
                                                      }
                                                    />
                                                    <span className="text-xs text-center text-main-view-fg/70">
                                                      {Math.round(
                                                        downloadProgress * 100
                                                      )}
                                                      %
                                                    </span>
                                                  </div>
                                                </>
                                              )
                                            }

                                            if (isDownloaded) {
                                              return (
                                                <div
                                                  className="flex items-center justify-center rounded bg-main-view-fg/10"
                                                  title={t('hub:useModel')}
                                                >
                                                  <Button
                                                    variant="link"
                                                    size="sm"
                                                    onClick={() =>
                                                      handleUseModel(
                                                        variant.model_id
                                                      )
                                                    }
                                                  >
                                                    {t('hub:use')}
                                                  </Button>
                                                </div>
                                              )
                                            }

                                            return (
                                              <div
                                                className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                                                title={t('hub:downloadModel')}
                                                onClick={() => {
                                                  addLocalDownloadingModel(
                                                    variant.model_id
                                                  )
                                                  serviceHub.models().pullModelWithMetadata(
                                                    variant.model_id,
                                                    variant.path,
                                                    filteredModels[
                                                      virtualItem.index
                                                    ].mmproj_models?.[0]?.path,
                                                    huggingfaceToken
                                                  )
                                                }}
                                              >
                                                <IconDownload
                                                  size={16}
                                                  className="text-main-view-fg/80"
                                                />
                                              </div>
                                            )
                                          })()}
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
