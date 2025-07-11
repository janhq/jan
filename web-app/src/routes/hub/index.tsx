/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn, fuzzySearch } from '@/lib/utils'
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
import { IconDownload, IconFileCode, IconSearch } from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import Joyride, { CallBackProps, STATUS } from 'react-joyride'
import { CustomTooltipJoyRide } from '@/containers/CustomeTooltipJoyRide'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CatalogModel, pullModel } from '@/services/models'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { Progress } from '@/components/ui/progress'
import HeaderPage from '@/containers/HeaderPage'
import { Loader } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

type ModelProps = {
  model: CatalogModel
}
type SearchParams = {
  repo: string
}
const defaultModelQuantizations = ['iq4_xs.gguf', 'q4_k_m.gguf']

export const Route = createFileRoute(route.hub.index as any)({
  component: Hub,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function Hub() {
  const { t } = useTranslation()
  const sortOptions = [
    { value: 'newest', name: t('hub:sortNewest') },
    { value: 'most-downloaded', name: t('hub:sortMostDownloaded') },
  ]
  const { sources, fetchSources, addSource, loading } = useModelSources()
  const search = useSearch({ from: route.hub.index as any })
  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )
  const [isSearching, setIsSearching] = useState(false)
  const [showOnlyDownloaded, setShowOnlyDownloaded] = useState(false)
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

  useEffect(() => {
    if (search.repo) {
      setSearchValue(search.repo || '')
      setIsSearching(true)
      addModelSourceTimeoutRef.current = setTimeout(() => {
        addSource(search.repo)
          .then(() => {
            fetchSources()
          })
          .finally(() => {
            setIsSearching(false)
          })
      }, 500)
    }
  }, [addSource, fetchSources, search])

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

  // Filtered models
  const filteredModels = useMemo(() => {
    let filtered = sortedModels

    // Apply search filter
    if (searchValue.length) {
      filtered = filtered?.filter(
        (e) =>
          fuzzySearch(
            searchValue.replace(/\s+/g, '').toLowerCase(),
            e.model_name.toLowerCase()
          ) ||
          e.quants.some((model) =>
            fuzzySearch(
              searchValue.replace(/\s+/g, '').toLowerCase(),
              model.model_id.toLowerCase()
            )
          )
      )
    }

    // Apply downloaded filter
    if (showOnlyDownloaded) {
      filtered = filtered?.filter((model) =>
        model.quants.some((variant) =>
          llamaProvider?.models.some(
            (m: { id: string }) => m.id === variant.model_id
          )
        )
      )
    }

    return filtered
  }, [searchValue, sortedModels, showOnlyDownloaded, llamaProvider?.models])

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setIsSearching(false)
    setSearchValue(e.target.value)
    if (addModelSourceTimeoutRef.current) {
      clearTimeout(addModelSourceTimeoutRef.current)
    }
    if (
      e.target.value.length &&
      (e.target.value.includes('/') || e.target.value.startsWith('http'))
    ) {
      setIsSearching(true)
      addModelSourceTimeoutRef.current = setTimeout(() => {
        addSource(e.target.value)
          .then(() => {
            fetchSources()
          })
          .finally(() => {
            setIsSearching(false)
          })
      }, 500)
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

  const DownloadButtonPlaceholder = useMemo(() => {
    return ({ model }: ModelProps) => {
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
        pullModel(modelId, modelUrl)
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
    downloadProcesses,
    llamaProvider?.models,
    isRecommendedModel,
    downloadButtonRef,
    localDownloadingModels,
    addLocalDownloadingModel,
    t,
    handleUseModel,
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
        <div className="flex items-center gap-2">
          <Switch
            checked={showOnlyDownloaded}
            onCheckedChange={setShowOnlyDownloaded}
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
              {loading ? (
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
                <div className="flex flex-col pb-2 mb-2 gap-2 ">
                  <div className="flex items-center gap-2 justify-end sm:hidden">
                    {renderFilter()}
                  </div>
                  {filteredModels.map((model, i) => (
                    <div key={`${model.model_name}-${i}`}>
                      <Card
                        header={
                          <div className="flex items-center justify-between gap-x-2">
                            <div
                              className="cursor-pointer"
                              onClick={() => {
                                console.log(model.model_name)
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
                                  'text-main-view-fg font-medium text-base capitalize  sm:max-w-none',
                                  isRecommendedModel(model.model_name)
                                    ? 'hub-model-card-step'
                                    : ''
                                )}
                                title={extractModelName(model.model_name) || ''}
                              >
                                {extractModelName(model.model_name) || ''}
                              </h1>
                            </div>
                            <div className="shrink-0 space-x-3 flex items-center">
                              <span className="text-main-view-fg/70 font-medium text-xs">
                                {
                                  (
                                    model.quants.find((m) =>
                                      defaultModelQuantizations.some((e) =>
                                        m.model_id.toLowerCase().includes(e)
                                      )
                                    ) ?? model.quants?.[0]
                                  )?.file_size
                                }
                              </span>
                              <DownloadButtonPlaceholder model={model} />
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
                              extractDescription(model?.description) || ''
                            }
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="capitalize text-main-view-fg/80">
                            {t('hub:by')} {model?.developer}
                          </span>
                          <div className="flex items-center gap-4 ml-2">
                            <div className="flex items-center gap-1">
                              <IconDownload
                                size={18}
                                className="text-main-view-fg/50"
                                title={t('hub:downloads')}
                              />
                              <span className="text-main-view-fg/80">
                                {model.downloads || 0}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <IconFileCode
                                size={20}
                                className="text-main-view-fg/50"
                                title={t('hub:variants')}
                              />
                              <span className="text-main-view-fg/80">
                                {model.quants?.length || 0}
                              </span>
                            </div>
                            {model.quants.length > 1 && (
                              <div className="flex items-center gap-2 hub-show-variants-step">
                                <Switch
                                  checked={!!expandedModels[model.model_name]}
                                  onCheckedChange={() =>
                                    toggleModelExpansion(model.model_name)
                                  }
                                />
                                <p className="text-main-view-fg/70">
                                  {t('hub:showVariants')}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        {expandedModels[model.model_name] &&
                          model.quants.length > 0 && (
                            <div className="mt-5">
                              {model.quants.map((variant) => (
                                <CardItem
                                  key={variant.model_id}
                                  title={variant.model_id}
                                  actions={
                                    <div className="flex items-center gap-2">
                                      <p className="text-main-view-fg/70 font-medium text-xs">
                                        {variant.file_size}
                                      </p>
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
                                                  value={downloadProgress * 100}
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
                                              pullModel(
                                                variant.model_id,
                                                variant.path
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
                              ))}
                            </div>
                          )}
                      </Card>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
