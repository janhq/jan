import { useState, useMemo, useEffect, useCallback, useRef } from 'react'

import Image from 'next/image'

import { InferenceEngine, Model } from '@janhq/core'
import {
  Badge,
  Button,
  Input,
  ScrollArea,
  Tabs,
  useClickOutside,
} from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadCloudIcon,
  XIcon,
} from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import ProgressCircle from '@/containers/Loader/ProgressCircle'

import ModelLabel from '@/containers/ModelLabel'

import SetupRemoteModel from '@/containers/SetupRemoteModel'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'
import { modelDownloadStateAtom } from '@/hooks/useDownloadState'
import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { formatDownloadPercentage, toGibibytes } from '@/utils/converter'

import {
  getLogoEngine,
  getTitleByEngine,
  isLocalEngine,
  priorityEngine,
} from '@/utils/modelEngine'

import { extensionManager } from '@/extension'

import { inActiveEngineProviderAtom } from '@/helpers/atoms/Extension.atom'
import {
  configuredModelsAtom,
  getDownloadingModelAtom,
  selectedModelAtom,
  showEngineListModelAtom,
} from '@/helpers/atoms/Model.atom'
import {
  activeThreadAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  chatInputMode?: boolean
  strictedThread?: boolean
  disabled?: boolean
}

const ModelDropdown = ({
  disabled,
  chatInputMode,
  strictedThread = true,
}: Props) => {
  const { downloadModel } = useDownloadModel()

  const [searchFilter, setSearchFilter] = useState('local')
  const [searchText, setSearchText] = useState('')
  const [open, setOpen] = useState(false)
  const activeThread = useAtomValue(activeThreadAtom)
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const [dropdownOptions, setDropdownOptions] = useState<HTMLDivElement | null>(
    null
  )
  const downloadStates = useAtomValue(modelDownloadStateAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const { updateModelParameter } = useUpdateModelParameters()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const configuredModels = useAtomValue(configuredModelsAtom)
  const featuredModel = configuredModels.filter((x) =>
    x.metadata?.tags?.includes('Featured')
  )
  const { updateThreadMetadata } = useCreateNewThread()

  useClickOutside(() => setOpen(false), null, [dropdownOptions, toggle])

  const [showEngineListModel, setShowEngineListModel] = useAtom(
    showEngineListModelAtom
  )

  const isModelSupportRagAndTools = useCallback((model: Model) => {
    return (
      model?.engine === InferenceEngine.openai ||
      isLocalEngine(model?.engine as InferenceEngine)
    )
  }, [])

  const filteredDownloadedModels = useMemo(
    () =>
      configuredModels
        .filter((e) =>
          e.name.toLowerCase().includes(searchText.toLowerCase().trim())
        )
        .filter((e) => {
          if (searchFilter === 'local') {
            return isLocalEngine(e.engine)
          }
          if (searchFilter === 'remote') {
            return !isLocalEngine(e.engine)
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .sort((a, b) => {
          const aInDownloadedModels = downloadedModels.some(
            (item) => item.id === a.id
          )
          const bInDownloadedModels = downloadedModels.some(
            (item) => item.id === b.id
          )
          if (aInDownloadedModels && !bInDownloadedModels) {
            return -1
          } else if (!aInDownloadedModels && bInDownloadedModels) {
            return 1
          } else {
            return 0
          }
        }),
    [configuredModels, searchText, searchFilter, downloadedModels]
  )

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (!activeThread) return
    const modelId = activeThread?.assistants?.[0]?.model?.id

    let model = downloadedModels.find((model) => model.id === modelId)
    if (!model) {
      model = recommendedModel
    }
    setSelectedModel(model)
  }, [recommendedModel, activeThread, downloadedModels, setSelectedModel])

  const onClickModelItem = useCallback(
    async (modelId: string) => {
      const model = downloadedModels.find((m) => m.id === modelId)
      setSelectedModel(model)
      setOpen(false)

      if (activeThread) {
        // Change assistand tools based on model support RAG
        updateThreadMetadata({
          ...activeThread,
          assistants: [
            {
              ...activeThread.assistants[0],
              tools: [
                {
                  type: 'retrieval',
                  enabled: isModelSupportRagAndTools(model as Model),
                  settings: {
                    ...(activeThread.assistants[0].tools &&
                      activeThread.assistants[0].tools[0]?.settings),
                  },
                },
              ],
            },
          ],
        })

        const overriddenSettings =
          model?.settings.ctx_len && model.settings.ctx_len > 4096
            ? { ctx_len: 4096 }
            : {}

        const modelParams = {
          ...model?.parameters,
          ...model?.settings,
          ...overriddenSettings,
        }

        // Update model parameter to the thread state
        setThreadModelParams(activeThread.id, modelParams)

        // Update model parameter to the thread file
        if (model)
          updateModelParameter(activeThread, {
            params: modelParams,
            modelId: model.id,
            engine: model.engine,
          })
      }
    },
    [
      downloadedModels,
      activeThread,
      setSelectedModel,
      isModelSupportRagAndTools,
      setThreadModelParams,
      updateModelParameter,
      updateThreadMetadata,
    ]
  )

  const [extensionHasSettings, setExtensionHasSettings] = useState<
    { name?: string; setting: string; apiKey: string; provider: string }[]
  >([])

  const inActiveEngineProvider = useAtomValue(inActiveEngineProviderAtom)

  useEffect(() => {
    const getAllSettings = async () => {
      const extensionsMenu: {
        name?: string
        setting: string
        apiKey: string
        provider: string
      }[] = []
      const extensions = extensionManager.getAll()

      for (const extension of extensions) {
        if (typeof extension.getSettings === 'function') {
          const settings = await extension.getSettings()
          if (
            (settings && settings.length > 0) ||
            (await extension.installationState()) !== 'NotRequired'
          ) {
            extensionsMenu.push({
              name: extension.productName,
              setting: extension.name,
              apiKey:
                'apiKey' in extension && typeof extension.apiKey === 'string'
                  ? extension.apiKey
                  : '',
              provider:
                'provider' in extension &&
                typeof extension.provider === 'string'
                  ? extension.provider
                  : '',
            })
          }
        }
      }
      setExtensionHasSettings(extensionsMenu)
    }
    getAllSettings()
  }, [])

  const findByEngine = filteredDownloadedModels
    .filter((x) => !inActiveEngineProvider.includes(x.engine))
    .map((x) => x.engine)

  const groupByEngine = findByEngine
    .filter(function (item, index) {
      if (findByEngine.indexOf(item) === index) return item
    })
    .sort((a, b) => {
      if (priorityEngine.includes(a) && priorityEngine.includes(b)) {
        return priorityEngine.indexOf(a) - priorityEngine.indexOf(b)
      } else if (priorityEngine.includes(a)) {
        return -1
      } else if (priorityEngine.includes(b)) {
        return 1
      } else {
        return 0 // Leave the rest in their original order
      }
    })

  const getEngineStatusReady: InferenceEngine[] = extensionHasSettings
    ?.filter((e) => e.apiKey.length > 0)
    .map((x) => x.provider as InferenceEngine)

  useEffect(() => {
    setShowEngineListModel((prev) => [
      ...prev,
      ...(getEngineStatusReady as InferenceEngine[]),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setShowEngineListModel, extensionHasSettings])

  const isDownloadALocalModel = downloadedModels.some((x) =>
    isLocalEngine(x.engine)
  )

  if (strictedThread && !activeThread) {
    return null
  }

  return (
    <div
      className={twMerge('relative', disabled && 'pointer-events-none')}
      data-testid="model-selector"
    >
      <div className="flex [&>div]:w-full" ref={setToggle}>
        {chatInputMode ? (
          <Badge
            data-testid="model-selector-badge"
            theme="secondary"
            variant={open ? 'solid' : 'outline'}
            className={twMerge(
              'inline-block max-w-[200px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap',
              open && 'border border-transparent'
            )}
            onClick={() => setOpen(!open)}
          >
            <span>{selectedModel?.name}</span>
          </Badge>
        ) : (
          <Input
            value={selectedModel?.name || ''}
            className="cursor-pointer"
            disabled={disabled}
            readOnly
            suffixIcon={
              <ChevronDownIcon
                size={14}
                className={twMerge(open && 'rotate-180')}
              />
            }
            onClick={() => setOpen(!open)}
          />
        )}
      </div>
      <div
        className={twMerge(
          'absolute right-0 z-20 mt-2 max-h-80 w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-sm',
          open ? 'flex' : 'hidden',
          chatInputMode && 'bottom-8 left-0 w-72'
        )}
        ref={setDropdownOptions}
      >
        <div className="w-full">
          <div className="p-2 pb-0">
            <Tabs
              options={[
                { name: 'On-device', value: 'local' },
                { name: 'Cloud', value: 'remote' },
              ]}
              tabStyle="segmented"
              value={searchFilter as string}
              onValueChange={(value) => setSearchFilter(value)}
            />
          </div>
          <div className="relative border-b border-[hsla(var(--app-border))] py-2">
            <Input
              placeholder="Search"
              value={searchText}
              ref={searchInputRef}
              className="rounded-none border-x-0 border-b-0 border-t-0 focus-within:ring-0 "
              onChange={(e) => setSearchText(e.target.value)}
              suffixIcon={
                searchText.length > 0 && (
                  <XIcon
                    size={16}
                    className="cursor-pointer"
                    onClick={() => setSearchText('')}
                  />
                )
              }
            />
          </div>
          <ScrollArea className="h-[calc(100%-90px)] w-full">
            {groupByEngine.map((engine, i) => {
              const apiKey = !isLocalEngine(engine)
                ? extensionHasSettings.filter((x) => x.provider === engine)[0]
                    ?.apiKey.length > 1
                : true
              const engineLogo = getLogoEngine(engine as InferenceEngine)
              const showModel = showEngineListModel.includes(engine)
              const onClickChevron = () => {
                if (showModel) {
                  setShowEngineListModel((prev) =>
                    prev.filter((item) => item !== engine)
                  )
                } else {
                  setShowEngineListModel((prev) => [...prev, engine])
                }
              }
              return (
                <div
                  className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0"
                  key={i}
                >
                  <div className="mt-2">
                    <div className="flex items-center justify-between px-4">
                      <div
                        className="flex w-full cursor-pointer items-center gap-2 py-1"
                        onClick={onClickChevron}
                      >
                        {engineLogo && (
                          <Image
                            className="h-6 w-6 flex-shrink-0"
                            width={48}
                            height={48}
                            src={engineLogo}
                            alt="logo"
                          />
                        )}
                        <h6 className="font-medium text-[hsla(var(--text-secondary))]">
                          {getTitleByEngine(engine)}
                        </h6>
                      </div>
                      <div className="-mr-2 flex gap-1">
                        {!isLocalEngine(engine) && (
                          <SetupRemoteModel engine={engine} />
                        )}
                        {!showModel ? (
                          <Button theme="icon" onClick={onClickChevron}>
                            <ChevronDownIcon
                              size={14}
                              className="text-[hsla(var(--text-secondary))]"
                            />
                          </Button>
                        ) : (
                          <Button theme="icon" onClick={onClickChevron}>
                            <ChevronUpIcon
                              size={14}
                              className="text-[hsla(var(--text-secondary))]"
                            />
                          </Button>
                        )}
                      </div>
                    </div>

                    {isLocalEngine(engine) &&
                      !isDownloadALocalModel &&
                      showModel &&
                      !searchText.length && (
                        <ul className="pb-2">
                          {featuredModel.map((model) => {
                            const isDownloading = downloadingModels.some(
                              (md) => md === model.id
                            )
                            return (
                              <li
                                key={model.id}
                                className="flex items-center justify-between gap-4 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                              >
                                <div className="flex items-center gap-2">
                                  <p
                                    className="line-clamp-1 text-[hsla(var(--text-secondary))]"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                  <ModelLabel
                                    metadata={model.metadata}
                                    compact
                                  />
                                </div>
                                <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                                  <span className="font-medium">
                                    {toGibibytes(model.metadata?.size)}
                                  </span>
                                  {!isDownloading ? (
                                    <DownloadCloudIcon
                                      size={18}
                                      className="cursor-pointer text-[hsla(var(--app-link))]"
                                      onClick={() =>
                                        downloadModel(
                                          model.sources[0].url,
                                          model.id
                                        )
                                      }
                                    />
                                  ) : (
                                    Object.values(downloadStates)
                                      .filter((x) => x.modelId === model.id)
                                      .map((item) => (
                                        <ProgressCircle
                                          key={item.modelId}
                                          percentage={
                                            formatDownloadPercentage(
                                              item?.percent,
                                              {
                                                hidePercentage: true,
                                              }
                                            ) as number
                                          }
                                          size={100}
                                        />
                                      ))
                                  )}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                    <ul className="pb-2">
                      {filteredDownloadedModels
                        .filter((x) => x.engine === engine)
                        .filter((y) => {
                          if (isLocalEngine(y.engine) && !searchText.length) {
                            return downloadedModels.find((c) => c.id === y.id)
                          } else {
                            return y
                          }
                        })
                        .map((model) => {
                          if (!showModel) return null
                          const isDownloading = downloadingModels.some(
                            (md) => md === model.id
                          )
                          const isDownloaded = downloadedModels.some(
                            (c) => c.id === model.id
                          )
                          return (
                            <li
                              key={model.id}
                              className={twMerge(
                                'flex items-center justify-between gap-4 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]',
                                !apiKey
                                  ? 'cursor-not-allowed text-[hsla(var(--text-tertiary))]'
                                  : 'text-[hsla(var(--text-primary))]'
                              )}
                              onClick={() => {
                                if (!apiKey && !isLocalEngine(model.engine))
                                  return null
                                if (isDownloaded) {
                                  onClickModelItem(model.id)
                                }
                              }}
                            >
                              <div className="flex gap-x-2">
                                <p
                                  className={twMerge(
                                    'line-clamp-1',
                                    !isDownloaded &&
                                      'text-[hsla(var(--text-secondary))]'
                                  )}
                                  title={model.name}
                                >
                                  {model.name}
                                </p>
                                <ModelLabel metadata={model.metadata} compact />
                              </div>
                              <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                                {!isDownloaded && (
                                  <span className="font-medium">
                                    {toGibibytes(model.metadata?.size)}
                                  </span>
                                )}
                                {!isDownloading && !isDownloaded ? (
                                  <DownloadCloudIcon
                                    size={18}
                                    className="cursor-pointer text-[hsla(var(--app-link))]"
                                    onClick={() =>
                                      downloadModel(
                                        model.sources[0].url,
                                        model.id
                                      )
                                    }
                                  />
                                ) : (
                                  Object.values(downloadStates)
                                    .filter((x) => x.modelId === model.id)
                                    .map((item) => (
                                      <ProgressCircle
                                        key={item.modelId}
                                        percentage={
                                          formatDownloadPercentage(
                                            item?.percent,
                                            {
                                              hidePercentage: true,
                                            }
                                          ) as number
                                        }
                                        size={100}
                                      />
                                    ))
                                )}
                              </div>
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                </div>
              )
            })}
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}

export default ModelDropdown
