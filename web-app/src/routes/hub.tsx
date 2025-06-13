/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn, fuzzySearch, toGigabytes } from '@/lib/utils'
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
import { addModelSource, downloadModel, fetchModelHub } from '@/services/models'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { Progress } from '@/components/ui/progress'
import HeaderPage from '@/containers/HeaderPage'
import { Loader } from 'lucide-react'

type ModelProps = {
  model: {
    id: string
    metadata?: any
    models: {
      id: string
    }[]
  }
}
type SearchParams = {
  repo: string
}

export const Route = createFileRoute(route.hub as any)({
  component: Hub,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

const sortOptions = [
  { value: 'newest', name: 'Newest' },
  { value: 'most-downloaded', name: 'Most downloaded' },
]

function Hub() {
  const { sources, fetchSources, loading } = useModelSources()
  const search = useSearch({ from: route.hub as any })
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

  const { getProviderByName } = useModelProvider()
  const llamaProvider = getProviderByName('llama.cpp')

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
        addModelSource(search.repo)
          .then(() => {
            fetchSources()
          })
          .finally(() => {
            setIsSearching(false)
          })
      }, 500)
    }
  }, [fetchSources, search])

  // Sorting functionality
  const sortedModels = useMemo(() => {
    return [...sources].sort((a, b) => {
      if (sortSelected === 'most-downloaded') {
        return (b.metadata?.downloads || 0) - (a.metadata?.downloads || 0)
      } else {
        return (
          new Date(b.metadata?.createdAt || 0).getTime() -
          new Date(a.metadata?.createdAt || 0).getTime()
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
            e.id.toLowerCase()
          ) ||
          e.models.some((model) =>
            fuzzySearch(
              searchValue.replace(/\s+/g, '').toLowerCase(),
              model.id.toLowerCase()
            )
          )
      )
    }

    // Apply downloaded filter
    if (showOnlyDownloaded) {
      filtered = filtered?.filter((model) =>
        model.models.some((variant) =>
          llamaProvider?.models.some((m: { id: string }) => m.id === variant.id)
        )
      )
    }

    return filtered
  }, [searchValue, sortedModels, showOnlyDownloaded, llamaProvider?.models])

  useEffect(() => {
    fetchModelHub()
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
        addModelSource(e.target.value)
          .then(() => {
            fetchSources()
          })
          .finally(() => {
            setIsSearching(false)
          })
      }, 500)
    }
  }

  const { downloads } = useDownloadStore()

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
    return (extractModelName(modelId) === 'Jan-nano') as boolean
  }, [])

  const handleUseModel = useCallback(
    (modelId: string) => {
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: modelId,
            provider: 'llama.cpp',
          },
        },
      })
    },
    [navigate]
  )

  const DownloadButtonPlaceholder = useMemo(() => {
    return ({ model }: ModelProps) => {
      const modelId = model.models[0]?.id
      const isDownloading = downloadProcesses.some((e) => e.id === modelId)
      const downloadProgress =
        downloadProcesses.find((e) => e.id === modelId)?.progress || 0
      const isDownloaded = llamaProvider?.models.some(
        (m: { id: string }) => m.id === modelId
      )
      const isRecommended = isRecommendedModel(model.metadata?.id)

      return (
        <div
          className={cn(
            'flex items-center',
            isRecommended && 'hub-download-button-step'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2 w-20 ',
              !isDownloading && 'opacity-0 visibility-hidden w-0'
            )}
          >
            <Progress value={downloadProgress * 100} />
            <span className="text-xs text-center text-main-view-fg/70">
              {Math.round(downloadProgress * 100)}%
            </span>
          </div>
          {isDownloaded ? (
            <Button size="sm" onClick={() => handleUseModel(modelId)}>
              Use
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => downloadModel(modelId)}
              className={cn(isDownloading && 'hidden')}
            >
              Download
            </Button>
          )}
        </div>
      )
    }
  }, [
    downloadProcesses,
    llamaProvider?.models,
    handleUseModel,
    isRecommendedModel,
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

    if (status === STATUS.FINISHED && !isDownloading && isLastStep) {
      const recommendedModel = filteredModels.find((model) =>
        isRecommendedModel(model.metadata?.id)
      )
      if (recommendedModel && recommendedModel.models[0]?.id) {
        downloadModel(recommendedModel.models[0].id)

        return
      }
    }

    if (status === STATUS.FINISHED) {
      navigate({
        to: route.hub,
      })
    }

    // Track current step index
    setCurrentStepIndex(index)
  }

  // Check if any model is currently downloading
  const isDownloading = downloadProcesses.length > 0

  const steps = [
    {
      target: '.hub-model-card-step',
      title: 'Recommended Model',
      disableBeacon: true,
      content:
        "Browse and download powerful AI models from various providers, all in one place. We suggest starting with Jan-Nano - a model optimized for function calling, tool integration, and research capabilities. It's ideal for building interactive AI agents.",
    },
    {
      target: '.hub-download-button-step',
      title: isDownloading ? 'Download in Progress' : 'Download Model',
      disableBeacon: true,
      content: isDownloading
        ? 'Your model is now downloading. Track progress here - once finished, it will be ready to use.'
        : 'Click the Download button to begin downloading the model.',
    },
  ]

  // Check if we're on the last step
  const isLastStep = currentStepIndex === steps.length - 1

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
        disableOverlayClose={true}
        callback={handleJoyrideCallback}
        locale={{
          back: 'Back',
          close: 'Close',
          last: !isDownloading ? 'Download' : 'Finish',
          next: 'Next',
          skip: 'Skip',
        }}
      />
      <div className="flex h-full w-full">
        <div className="flex flex-col h-full w-full ">
          <HeaderPage>
            <div className="pr-4 py-3  h-10 w-full flex items-center justify-between relative z-20">
              <div className="flex items-center gap-2 w-full">
                {isSearching ? (
                  <Loader className="size-4 animate-spin text-main-view-fg/60" />
                ) : (
                  <IconSearch className="text-main-view-fg/60" size={14} />
                )}
                <input
                  placeholder="Search for models on Hugging Face..."
                  value={searchValue}
                  onChange={handleSearchChange}
                  className="w-full focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <span
                      title="Edit Theme"
                      className="flex cursor-pointer items-center gap-1 px-2 py-1 rounded-sm bg-main-view-fg/15 text-sm outline-none text-main-view-fg font-medium"
                    >
                      {
                        sortOptions.find(
                          (option) => option.value === sortSelected
                        )?.name
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
                    Downloaded
                  </span>
                </div>
              </div>
            </div>
          </HeaderPage>
          <div className="p-4 w-full h-[calc(100%-32px)] overflow-y-auto first-step-setup-local-provider">
            <div className="flex flex-col h-full justify-between gap-4 gap-y-3 w-4/5 mx-auto">
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    Loading models...
                  </div>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    No models found
                  </div>
                </div>
              ) : (
                <div className="flex flex-col pb-2 mb-2 gap-2 ">
                  {filteredModels.map((model) => (
                    <div key={model.id}>
                      <Card
                        header={
                          <div className="flex items-center justify-between gap-x-2">
                            <Link
                              to={
                                `https://huggingface.co/${model.metadata?.id}` as string
                              }
                              target="_blank"
                            >
                              <h1
                                className={cn(
                                  'text-main-view-fg font-medium text-base capitalize truncate',
                                  isRecommendedModel(model.metadata?.id)
                                    ? 'hub-model-card-step'
                                    : ''
                                )}
                              >
                                {extractModelName(model.metadata?.id) || ''}
                              </h1>
                            </Link>
                            <div className="shrink-0 space-x-3 flex items-center">
                              <span className="text-main-view-fg/70 font-medium text-xs">
                                {toGigabytes(model.models?.[0]?.size)}
                              </span>
                              <DownloadButtonPlaceholder model={model} />
                            </div>
                          </div>
                        }
                      >
                        <div className="line-clamp-2 mt-3 text-main-view-fg/60">
                          <RenderMarkdown
                            enableRawHtml={true}
                            className="select-none"
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
                              extractDescription(model.metadata?.description) ||
                              ''
                            }
                          />
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="capitalize text-main-view-fg/80">
                            By {model?.author}
                          </span>
                          <div className="flex items-center gap-4 ml-2">
                            <div className="flex items-center gap-1">
                              <IconDownload
                                size={18}
                                className="text-main-view-fg/50"
                                title="Downloads"
                              />
                              <span className="text-main-view-fg/80">
                                {model.metadata?.downloads || 0}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <IconFileCode
                                size={20}
                                className="text-main-view-fg/50"
                                title="Variants"
                              />
                              <span className="text-main-view-fg/80">
                                {model.models?.length || 0}
                              </span>
                            </div>
                            {model.models.length > 1 && (
                              <div className="flex items-center gap-2 hub-show-variants-step">
                                <Switch
                                  checked={!!expandedModels[model.id]}
                                  onCheckedChange={() =>
                                    toggleModelExpansion(model.id)
                                  }
                                />
                                <p className="text-main-view-fg/70">
                                  Show variants
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                        {expandedModels[model.id] &&
                          model.models.length > 0 && (
                            <div className="mt-5">
                              {model.models.map((variant) => (
                                <CardItem
                                  key={variant.id}
                                  title={variant.id}
                                  actions={
                                    <div className="flex items-center gap-2">
                                      <p className="text-main-view-fg/70 font-medium text-xs">
                                        {toGigabytes(variant.size)}
                                      </p>
                                      {(() => {
                                        const isDownloading =
                                          downloadProcesses.some(
                                            (e) => e.id === variant.id
                                          )
                                        const downloadProgress =
                                          downloadProcesses.find(
                                            (e) => e.id === variant.id
                                          )?.progress || 0
                                        const isDownloaded =
                                          llamaProvider?.models.some(
                                            (m: { id: string }) =>
                                              m.id === variant.id
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
                                              title="Use this model"
                                            >
                                              <Button
                                                variant="link"
                                                size="sm"
                                                onClick={() =>
                                                  handleUseModel(variant.id)
                                                }
                                              >
                                                Use
                                              </Button>
                                            </div>
                                          )
                                        }

                                        return (
                                          <div
                                            className="size-6 cursor-pointer flex items-center justify-center rounded hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                                            title="Download model"
                                            onClick={() =>
                                              downloadModel(variant.id)
                                            }
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
