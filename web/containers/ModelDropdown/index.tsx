import { useState, useMemo, useEffect, useCallback } from 'react'

import { InferenceEngine } from '@janhq/core'
import { Badge, Input, ScrollArea, Select, useClickOutside } from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { ChevronDownIcon, XIcon } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

import ModelLabel from '@/containers/ModelLabel'

import SetupRemoteModel from '@/containers/SetupRemoteModel'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  activeThreadAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

type Props = {
  chatInputMode?: boolean
}

const ModelDropdown = ({ chatInputMode }: Props) => {
  const [searchFilter, setSearchFilter] = useState('all')
  const [filterOptionsOpen, setFilterOptionsOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [open, setOpen] = useState(false)
  const activeThread = useAtomValue(activeThreadAtom)
  const [toggle, setToggle] = useState<HTMLDivElement | null>(null)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const [dropdownOptions, setDropdownOptions] = useState<HTMLDivElement | null>(
    null
  )
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const { updateModelParameter } = useUpdateModelParameters()

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

  return (
    <>
      <div className="relative">
        <div ref={setToggle}>
          {chatInputMode ? (
            <Badge
              theme="secondary"
              className="cursor-pointer"
              onClick={() => setOpen(!open)}
            >
              {selectedModel?.name}
            </Badge>
          ) : (
            <Input
              value={selectedModel?.name}
              className="cursor-pointer"
              readOnly
              suffixIcon={
                <ChevronDownIcon
                  size={14}
                  className={twMerge(open && 'rotate-180')}
                />
              }
              onChange={() => console.log('change')}
              onClick={() => setOpen(!open)}
            />
          )}
        </div>
        <div
          className={twMerge(
            'absolute right-0 z-20 mt-2 max-h-80 w-full overflow-hidden rounded-lg border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow-sm',
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
              ).length !== 0 && (
                <div className="relative w-full">
                  <div className="mt-2 px-4">
                    <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                      cortex.cpp
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
                                  <p
                                    className="line-clamp-1"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                  <ModelLabel
                                    metadata={model.metadata}
                                    compact
                                  />
                                </li>
                              )
                            })
                        : null}
                    </ul>
                  </div>
                </div>
              )}

              {filteredDownloadedModels.filter(
                (x) => x.engine === InferenceEngine.cohere
              ).length !== 0 && (
                <div className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0">
                  <div className="mt-2 px-4">
                    <div className="flex items-center justify-between">
                      <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                        Cohere
                      </h6>
                      <SetupRemoteModel engine={InferenceEngine.cohere} />
                    </div>
                    <ul>
                      {filteredDownloadedModels
                        ? filteredDownloadedModels
                            .filter((x) => x.engine === InferenceEngine.cohere)
                            .map((model) => {
                              return (
                                <li
                                  key={model.id}
                                  className="cursor-pointer pb-3"
                                  onClick={() => onClickModelItem(model.id)}
                                >
                                  <p
                                    className="line-clamp-1"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                </li>
                              )
                            })
                        : null}
                    </ul>
                  </div>
                </div>
              )}

              {filteredDownloadedModels.filter(
                (x) => x.engine === InferenceEngine.groq
              ).length !== 0 && (
                <div className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0">
                  <div className="mt-2 px-4">
                    <div className="flex items-center justify-between">
                      <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                        Groq
                      </h6>

                      <SetupRemoteModel engine={InferenceEngine.groq} />
                    </div>
                    <ul>
                      {filteredDownloadedModels
                        ? filteredDownloadedModels
                            .filter((x) => x.engine === InferenceEngine.groq)
                            .map((model) => {
                              return (
                                <li
                                  key={model.id}
                                  className="cursor-pointer pb-3"
                                  onClick={() => onClickModelItem(model.id)}
                                >
                                  <p
                                    className="line-clamp-1"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                </li>
                              )
                            })
                        : null}
                    </ul>
                  </div>
                </div>
              )}

              {filteredDownloadedModels.filter(
                (x) => x.engine === InferenceEngine.openai
              ).length !== 0 && (
                <div className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0">
                  <div className="mt-2 px-4">
                    <div className="flex items-center justify-between">
                      <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                        Open AI
                      </h6>
                      <SetupRemoteModel engine={InferenceEngine.openai} />
                    </div>
                    <ul>
                      {filteredDownloadedModels
                        ? filteredDownloadedModels
                            .filter((x) => x.engine === InferenceEngine.openai)
                            .map((model) => {
                              return (
                                <li
                                  key={model.id}
                                  className="cursor-pointer pb-3"
                                  onClick={() => onClickModelItem(model.id)}
                                >
                                  <p
                                    className="line-clamp-1"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                </li>
                              )
                            })
                        : null}
                    </ul>
                  </div>
                </div>
              )}

              {filteredDownloadedModels.filter(
                (x) => x.engine === InferenceEngine.triton_trtllm
              ).length !== 0 && (
                <div className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0">
                  <div className="mt-2 px-4">
                    <div className="flex items-center justify-between">
                      <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                        Triton trtllm
                      </h6>

                      <SetupRemoteModel
                        engine={InferenceEngine.triton_trtllm}
                      />
                    </div>
                    <ul>
                      {filteredDownloadedModels
                        ? filteredDownloadedModels
                            .filter(
                              (x) => x.engine === InferenceEngine.triton_trtllm
                            )
                            .map((model) => {
                              return (
                                <li
                                  key={model.id}
                                  className="cursor-pointer pb-3"
                                  onClick={() => onClickModelItem(model.id)}
                                >
                                  <p
                                    className="line-clamp-1"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                </li>
                              )
                            })
                        : null}
                    </ul>
                  </div>
                </div>
              )}

              {filteredDownloadedModels.filter(
                (x) => x.engine === InferenceEngine.nitro_tensorrt_llm
              ).length !== 0 && (
                <div className="relative w-full border-t border-[hsla(var(--app-border))] first:border-t-0">
                  <div className="mt-2 px-4">
                    <h6 className="my-3 font-medium text-[hsla(var(--text-secondary))]">
                      Nitro Tensorrt llm
                    </h6>
                    <ul>
                      {filteredDownloadedModels
                        ? filteredDownloadedModels
                            .filter(
                              (x) =>
                                x.engine === InferenceEngine.nitro_tensorrt_llm
                            )
                            .map((model) => {
                              return (
                                <li
                                  key={model.id}
                                  className="cursor-pointer pb-3"
                                  onClick={() => onClickModelItem(model.id)}
                                >
                                  <p
                                    className="line-clamp-1"
                                    title={model.name}
                                  >
                                    {model.name}
                                  </p>
                                </li>
                              )
                            })
                        : null}
                    </ul>
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </>
  )
}

export default ModelDropdown
