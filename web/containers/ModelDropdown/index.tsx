import { useState, useMemo, useEffect, useCallback, useRef } from 'react'

import Image from 'next/image'

import { EngineConfig, InferenceEngine } from '@janhq/core'
import {
  Badge,
  Button,
  Input,
  ScrollArea,
  Tabs,
  useClickOutside,
} from '@janhq/joi'

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

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

import { useActiveModel } from '@/hooks/useActiveModel'

import { useCreateNewThread } from '@/hooks/useCreateNewThread'
import useDownloadModel from '@/hooks/useDownloadModel'
import { modelDownloadStateAtom } from '@/hooks/useDownloadState'
import { useGetEngines } from '@/hooks/useEngineManagement'

import { useGetFeaturedSources } from '@/hooks/useModelSource'
import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { formatDownloadPercentage, toGigabytes } from '@/utils/converter'

import { getLogoEngine, getTitleByEngine } from '@/utils/modelEngine'

import { extractModelName } from '@/utils/modelSource'

import { activeAssistantAtom } from '@/helpers/atoms/Assistant.atom'
import {
  configuredModelsAtom,
  getDownloadingModelAtom,
  selectedModelAtom,
  showEngineListModelAtom,
} from '@/helpers/atoms/Model.atom'

import { showScrollBarAtom } from '@/helpers/atoms/Setting.atom'
import {
  activeThreadAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  chatInputMode?: boolean
  strictedThread?: boolean
  disabled?: boolean
}

export const modelDropdownStateAtom = atom(false)

const ModelDropdown = ({
  disabled,
  chatInputMode,
  strictedThread = true,
}: Props) => {
  const { downloadModel } = useDownloadModel()
  const [modelDropdownState, setModelDropdownState] = useAtom(
    modelDropdownStateAtom
  )
  const showScrollBar = useAtomValue(showScrollBarAtom)

  const [searchFilter, setSearchFilter] = useState('local')
  const [searchText, setSearchText] = useState('')
  const [open, setOpen] = useState<boolean>(modelDropdownState)
  const activeThread = useAtomValue(activeThreadAtom)
  const activeAssistant = useAtomValue(activeAssistantAtom)
  const downloadingModels = useAtomValue(getDownloadingModelAtom)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const [dropdownOptions, setDropdownOptions] = useState<HTMLDivElement | null>(
    null
  )
  const { sources: featuredModels } = useGetFeaturedSources()

  const { engines } = useGetEngines()

  const downloadStates = useAtomValue(modelDownloadStateAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const { updateModelParameter } = useUpdateModelParameters()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const configuredModels = useAtomValue(configuredModelsAtom)
  const { stopModel } = useActiveModel()

  const { updateThreadMetadata } = useCreateNewThread()

  const engineList = useMemo(
    () =>
      Object.entries(engines ?? {}).flatMap((e) => ({
        name: e[0],
        type: e[1][0]?.type === 'remote' ? 'remote' : 'local',
        engine: e[1][0],
      })),
    [engines]
  )

  useClickOutside(() => handleChangeStateOpen(false), null, [
    dropdownOptions,
    toggle,
  ])

  const [showEngineListModel, setShowEngineListModel] = useAtom(
    showEngineListModelAtom
  )

  const handleChangeStateOpen = useCallback(
    (state: boolean) => {
      setOpen(state)
      setModelDropdownState(state)
    },
    [setModelDropdownState]
  )

  const filteredDownloadedModels = useMemo(
    () =>
      configuredModels
        .concat(
          downloadedModels.filter(
            (e) => !configuredModels.some((x) => x.id === e.id)
          )
        )
        .filter((e) =>
          e.name.toLowerCase().includes(searchText.toLowerCase().trim())
        )
        .filter((e) => {
          if (searchFilter === 'local') {
            return (
              engineList.find((t) => t.engine?.engine === e.engine)?.type ===
              'local'
            )
          }
          return true
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
    [configuredModels, searchText, searchFilter, downloadedModels, engineList]
  )

  useEffect(() => {
    if (modelDropdownState && chatInputMode) {
      setOpen(modelDropdownState)
    }
  }, [chatInputMode, modelDropdownState])

  useEffect(() => {
    if (open && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    setShowEngineListModel((prev) => [
      ...prev,
      ...engineList
        .filter((x) => (x.engine?.api_key?.length ?? 0) > 0)
        .map((e) => e.name),
    ])
  }, [setShowEngineListModel, engineList])

  useEffect(() => {
    if (!activeThread) return
    const modelId = activeAssistant?.model?.id

    const model = downloadedModels.find((model) => model.id === modelId)
    if (model) {
      if (
        engines?.[model.engine]?.[0]?.type === 'local' ||
        (engines?.[model.engine]?.[0]?.api_key?.length ?? 0) > 0
      )
        setSelectedModel(model)
    } else {
      setSelectedModel(undefined)
    }
  }, [
    recommendedModel,
    activeThread,
    downloadedModels,
    setSelectedModel,
    activeAssistant?.model?.id,
    engines,
  ])

  const isLocalEngine = useCallback(
    (engine?: string) => {
      if (!engine) return false
      return engineList.some((t) => t.name === engine && t.type === 'local')
    },
    [engineList]
  )

  const onClickModelItem = useCallback(
    async (modelId: string) => {
      if (!activeAssistant) return
      const model = downloadedModels.find((m) => m.id === modelId)
      setSelectedModel(model)
      setOpen(false)
      stopModel()

      if (activeThread) {
        // Change assistand tools based on model support RAG
        updateThreadMetadata({
          ...activeThread,
          assistants: [
            {
              ...activeAssistant,
              tools: [
                {
                  type: 'retrieval',
                  enabled: model?.engine === InferenceEngine.cortex,
                  settings: {
                    ...(activeAssistant.tools &&
                      activeAssistant.tools[0]?.settings),
                  },
                },
              ],
            },
          ],
        })

        const contextLength = model?.settings.ctx_len
          ? Math.min(8192, model?.settings.ctx_len ?? 8192)
          : undefined
        const overriddenParameters = {
          ctx_len: contextLength,
          max_tokens: contextLength
            ? Math.min(model?.parameters.max_tokens ?? 8192, contextLength)
            : model?.parameters.max_tokens,
        }

        const modelParams = {
          ...model?.parameters,
          ...model?.settings,
          ...overriddenParameters,
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
      activeAssistant,
      downloadedModels,
      setSelectedModel,
      activeThread,
      updateThreadMetadata,
      setThreadModelParams,
      updateModelParameter,
      stopModel,
    ]
  )

  const isDownloadALocalModel = useMemo(
    () =>
      downloadedModels.some((x) =>
        engineList.some((t) => t.name === x.engine && t.type === 'local')
      ),
    [downloadedModels, engineList]
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
            onClick={() => handleChangeStateOpen(!open)}
          >
            <span
              className={twMerge(
                !selectedModel && 'text-[hsla(var(--text-tertiary))]'
              )}
            >
              {selectedModel?.name || 'Select a model'}
            </span>
          </Badge>
        ) : (
          <Input
            value={selectedModel?.name || ''}
            className="cursor-pointer"
            placeholder="Select a model"
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
          <ScrollArea
            type={showScrollBar ? 'always' : 'scroll'}
            className="h-[calc(100%-90px)] w-full"
          >
            {engineList
              .filter((e) => e.type === searchFilter)
              .filter(
                (e) =>
                  e.type === 'remote' ||
                  e.name === InferenceEngine.cortex_llamacpp ||
                  filteredDownloadedModels.some((e) => e.engine === e.name)
              )
              .map((engine, i) => {
                const isConfigured =
                  engine.type === 'local' ||
                  ((engine.engine as EngineConfig).api_key?.length ?? 0) > 1
                const engineLogo = getLogoEngine(engine.name as InferenceEngine)
                const showModel = showEngineListModel.includes(engine.name)
                const onClickChevron = () => {
                  if (showModel) {
                    setShowEngineListModel((prev) =>
                      prev.filter((item) => item !== engine.name)
                    )
                  } else {
                    setShowEngineListModel((prev) => [...prev, engine.name])
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
                          <h6 className="font-medium capitalize text-[hsla(var(--text-secondary))]">
                            {getTitleByEngine(engine.name)}
                          </h6>
                        </div>
                        <div className="-mr-2 flex gap-1">
                          {engine.type === 'remote' && (
                            <SetupRemoteModel
                              engine={engine.name as InferenceEngine}
                              isConfigured={
                                (engine.engine.api_key?.length ?? 0) > 0
                              }
                            />
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

                      {engine.type === 'local' &&
                        !isDownloadALocalModel &&
                        showModel &&
                        !searchText.length && (
                          <ul className="pb-2">
                            {featuredModels?.map((model) => {
                              const isDownloading = downloadingModels.some(
                                (md) => md === (model.models[0]?.id ?? model.id)
                              )
                              return (
                                <li
                                  key={model.id}
                                  className="flex items-center justify-between gap-4 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]"
                                >
                                  <div className="flex items-center gap-2">
                                    <p
                                      className="max-w-[200px] overflow-hidden truncate whitespace-nowrap capitalize text-[hsla(var(--text-secondary))]"
                                      title={model.id}
                                    >
                                      {extractModelName(model.id)}
                                    </p>
                                    <ModelLabel
                                      size={model.models[0]?.size}
                                      compact
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                                    <span className="font-medium">
                                      {toGigabytes(model.models[0]?.size)}
                                    </span>
                                    {!isDownloading ? (
                                      <DownloadCloudIcon
                                        size={18}
                                        className="cursor-pointer text-[hsla(var(--app-link))]"
                                        onClick={() =>
                                          downloadModel(model.models[0]?.id)
                                        }
                                      />
                                    ) : (
                                      Object.values(downloadStates)
                                        .filter(
                                          (x) =>
                                            x.modelId ===
                                            (model.models[0]?.id ?? model.id)
                                        )
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
                          .filter(
                            (x) =>
                              x.engine === engine.name ||
                              (x.engine === InferenceEngine.nitro &&
                                engine.name === InferenceEngine.cortex_llamacpp)
                          )
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
                              <>
                                {isDownloaded && (
                                  <li
                                    key={model.id}
                                    className={twMerge(
                                      'flex items-center justify-between gap-4 px-3 py-2 hover:bg-[hsla(var(--dropdown-menu-hover-bg))]',
                                      !isConfigured
                                        ? 'cursor-not-allowed text-[hsla(var(--text-tertiary))]'
                                        : 'text-[hsla(var(--text-primary))]'
                                    )}
                                    onClick={() => {
                                      if (
                                        !isConfigured &&
                                        engine.type === 'remote'
                                      )
                                        return null
                                      if (isDownloaded) {
                                        onClickModelItem(model.id)
                                      }
                                    }}
                                  >
                                    <div className="flex gap-x-2">
                                      <p
                                        className={twMerge(
                                          'max-w-[200px] overflow-hidden truncate whitespace-nowrap',
                                          !isDownloaded &&
                                            'text-[hsla(var(--text-secondary))]'
                                        )}
                                        title={model.name}
                                      >
                                        {model.name}
                                      </p>
                                      <ModelLabel
                                        size={model.metadata?.size}
                                        compact
                                      />
                                    </div>
                                    <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                                      {!isDownloaded && (
                                        <span className="font-medium">
                                          {toGigabytes(model.metadata?.size)}
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
                                )}
                              </>
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
