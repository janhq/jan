import { useState, useMemo, useEffect, useCallback } from 'react'

import { InferenceEngine } from '@janhq/core'
import { Badge, Input, ScrollArea, Select, useClickOutside } from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ChevronDownIcon, DownloadCloudIcon, XIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import ModelLabel from '@/containers/ModelLabel'

import SetupRemoteModel from '@/containers/SetupRemoteModel'

import useDownloadModel from '@/hooks/useDownloadModel'
import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { toGibibytes } from '@/utils/converter'

import { extensionManager } from '@/extension'

import { inActiveEngineProviderAtom } from '@/helpers/atoms/Extension.atom'
import {
  configuredModelsAtom,
  getDownloadingModelAtom,
  selectedModelAtom,
} from '@/helpers/atoms/Model.atom'
import {
  activeThreadAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  chatInputMode?: boolean
  strictedThread?: boolean
}

const ModelDropdown = ({ chatInputMode, strictedThread = true }: Props) => {
  const { downloadModel } = useDownloadModel()
  const [searchFilter, setSearchFilter] = useState('all')
  const [filterOptionsOpen, setFilterOptionsOpen] = useState(false)
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
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const { updateModelParameter } = useUpdateModelParameters()

  const configuredModels = useAtomValue(configuredModelsAtom)
  const featuredModel = configuredModels.filter((x) =>
    x.metadata.tags.includes('Featured')
  )

  useClickOutside(() => !filterOptionsOpen && setOpen(false), null, [
    dropdownOptions,
    toggle,
  ])

  const filteredDownloadedModels = useMemo(
    () =>
      downloadedModels
        .filter((e) =>
          e.name.toLowerCase().includes(searchText.toLowerCase().trim())
        )
        .filter((e) => {
          if (searchFilter === 'all') {
            return e.engine
          }
          if (searchFilter === 'local') {
            return (
              e.engine === InferenceEngine.nitro ||
              e.engine === InferenceEngine.nitro_tensorrt_llm
            )
          }
          if (searchFilter === 'remote') {
            return (
              e.engine !== InferenceEngine.nitro &&
              e.engine !== InferenceEngine.nitro_tensorrt_llm
            )
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [downloadedModels, searchText, searchFilter]
  )

  useEffect(() => {
    if (!activeThread) return
    let model = downloadedModels.find(
      (model) => model.id === activeThread.assistants[0].model.id
    )
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
        // Default setting ctx_len for the model for a better onboarding experience
        // TODO: When Cortex support hardware instructions, we should remove this
        const overriddenSettings =
          model?.settings.ctx_len && model.settings.ctx_len > 2048
            ? { ctx_len: 2048 }
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
      setThreadModelParams,
      updateModelParameter,
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

  const groupByEngine = findByEngine.filter(function (item, index) {
    if (findByEngine.indexOf(item) === index)
      return item !== InferenceEngine.nitro
  })

  if (strictedThread && !activeThread) {
    return null
  }

  return (
    <div className="relative">
      <div ref={setToggle}>
        {chatInputMode ? (
          <Badge
            theme="secondary"
            className="cursor-pointer"
            onClick={() => setOpen(!open)}
          >
            <span className="line-clamp-1 ">{selectedModel?.name}</span>
          </Badge>
        ) : (
          <Input
            value={selectedModel?.name || ''}
            className="cursor-pointer"
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
          'w=80 absolute right-0 z-20 mt-2 max-h-80 w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-sm',
          open ? 'flex' : 'hidden',
          chatInputMode && 'bottom-8 left-0 w-80'
        )}
        ref={setDropdownOptions}
      >
        <div className="w-full">
          <div className="relative">
            <Input
              placeholder="Search"
              value={searchText}
              className="rounded-none border-x-0 border-t-0 focus-within:ring-0"
              onChange={(e) => setSearchText(e.target.value)}
              suffixIcon={
                <XIcon
                  size={16}
                  className="cursor-pointer"
                  onClick={() => setSearchText('')}
                />
              }
            />
            <div
              className={twMerge(
                'absolute right-2 top-1/2 -translate-y-1/2',
                searchText.length && 'hidden'
              )}
            >
              <Select
                value={searchFilter}
                className="h-6 gap-1 px-2"
                options={[
                  { name: 'All', value: 'all' },
                  { name: 'Local', value: 'local' },
                  { name: 'Remote', value: 'remote' },
                ]}
                onValueChange={(value) => setSearchFilter(value)}
                onOpenChange={(open) => setFilterOptionsOpen(open)}
              />
            </div>
          </div>
          <ScrollArea className="h-[calc(100%-36px)] w-full">
            {filteredDownloadedModels.filter(
              (x) => x.engine === InferenceEngine.nitro
            ).length !== 0 ? (
              <div className="relative w-full">
                <div className="mt-2 px-4">
                  <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                    Cortex
                  </h6>
                  <ul>
                    {filteredDownloadedModels
                      ? filteredDownloadedModels
                          .filter((x) => x.engine === InferenceEngine.nitro)
                          .map((model) => {
                            return (
                              <li
                                key={model.id}
                                className="flex cursor-pointer items-center gap-2 pb-3"
                                onClick={() => onClickModelItem(model.id)}
                              >
                                <p className="line-clamp-1" title={model.name}>
                                  {model.name}
                                </p>
                                <ModelLabel metadata={model.metadata} compact />
                              </li>
                            )
                          })
                      : null}
                  </ul>
                </div>
              </div>
            ) : (
              <>
                {searchFilter !== 'remote' && (
                  <div className="relative w-full">
                    <div className="mt-2 px-4">
                      <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                        Cortex
                      </h6>
                      <ul>
                        {featuredModel.map((model) => {
                          const isDownloading = downloadingModels.some(
                            (md) => md.id === model.id
                          )
                          return (
                            <li
                              key={model.id}
                              className="flex items-center justify-between gap-4 pb-3"
                            >
                              <div className="flex items-center gap-2">
                                <p
                                  className="line-clamp-1 text-[hsla(var(--text-tertiary))]"
                                  title={model.name}
                                >
                                  {model.name}
                                </p>
                                <ModelLabel metadata={model.metadata} compact />
                              </div>
                              <div className="flex items-center gap-2 text-[hsla(var(--text-tertiary))]">
                                <span className="font-medium">
                                  {toGibibytes(model.metadata.size)}
                                </span>
                                {!isDownloading && (
                                  <DownloadCloudIcon
                                    size={18}
                                    className="cursor-pointer text-[hsla(var(--text-link))]"
                                    onClick={() => downloadModel(model)}
                                  />
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}

            {groupByEngine.map((engine, i) => {
              const apiKey =
                extensionHasSettings.filter((x) => x.provider === engine)[0]
                  ?.apiKey.length > 1
              return (
                <div
                  className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0"
                  key={i}
                >
                  <div className="mt-2 px-4">
                    <div className="flex items-center justify-between">
                      <h6 className="my-3 font-medium capitalize text-[hsla(var(--text-secondary))]">
                        {engine}
                      </h6>
                      <div className="-mr-2">
                        <SetupRemoteModel engine={engine} />
                      </div>
                    </div>
                    <ul>
                      {filteredDownloadedModels
                        .filter((x) => x.engine === engine)
                        .map((model) => {
                          return (
                            <li
                              key={model.id}
                              className={twMerge(
                                'cursor-pointer pb-3',
                                !apiKey &&
                                  'cursor-default text-[hsla(var(--text-tertiary))]'
                              )}
                              onClick={() =>
                                apiKey && onClickModelItem(model.id)
                              }
                            >
                              <p className="line-clamp-1" title={model.name}>
                                {model.name}
                              </p>
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
