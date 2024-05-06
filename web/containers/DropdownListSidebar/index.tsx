import { useCallback, useEffect, useState } from 'react'

import { InferenceEngine, Model } from '@janhq/core'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectPortal,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@janhq/uikit'

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import {
  MonitorIcon,
  LayoutGridIcon,
  FoldersIcon,
  GlobeIcon,
  CheckIcon,
  CopyIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useClipboard } from '@/hooks/useClipboard'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { toGibibytes } from '@/utils/converter'

import ModelLabel from '../ModelLabel'

import { mainViewStateAtom } from '@/helpers/atoms/App.atom'
import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import {
  activeThreadAtom,
  setThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export const selectedModelAtom = atom<Model | undefined>(undefined)

const engineOptions = ['Local', 'Remote']

// TODO: Move all of the unscoped logics outside of the component
const DropdownListSidebar = ({
  strictedThread = true,
}: {
  strictedThread?: boolean
}) => {
  const activeThread = useAtomValue(activeThreadAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const [isTabActive, setIsTabActive] = useState(0)
  const { stateModel } = useActiveModel()
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)

  const setMainViewState = useSetAtom(mainViewStateAtom)
  const [loader, setLoader] = useState(0)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const { updateModelParameter } = useUpdateModelParameters()
  const clipboard = useClipboard({ timeout: 1000 })

  const [copyId, setCopyId] = useState('')

  // TODO: Update filter condition for the local model
  const localModel = downloadedModels.filter(
    (model) =>
      model.engine === InferenceEngine.nitro ||
      model.engine === InferenceEngine.nitro_tensorrt_llm
  )
  const remoteModel = downloadedModels.filter(
    (model) =>
      model.engine !== InferenceEngine.nitro &&
      model.engine !== InferenceEngine.nitro_tensorrt_llm
  )

  const modelOptions = isTabActive === 0 ? localModel : remoteModel

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

  // This is fake loader please fix this when we have realtime percentage when load model
  useEffect(() => {
    if (stateModel.model === selectedModel?.id && stateModel.loading) {
      if (loader === 24) {
        setTimeout(() => {
          setLoader(loader + 1)
        }, 250)
      } else if (loader === 50) {
        setTimeout(() => {
          setLoader(loader + 1)
        }, 250)
      } else if (loader === 78) {
        setTimeout(() => {
          setLoader(loader + 1)
        }, 250)
      } else if (loader === 85) {
        setLoader(85)
      } else {
        setLoader(loader + 1)
      }
    } else {
      setLoader(0)
    }
  }, [stateModel.loading, loader, selectedModel, stateModel.model])

  const onValueSelected = useCallback(
    async (modelId: string) => {
      const model = downloadedModels.find((m) => m.id === modelId)
      setSelectedModel(model)

      if (serverEnabled) {
        window.core?.api?.stopServer()
        setServerEnabled(false)
      }

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
      serverEnabled,
      activeThread,
      setSelectedModel,
      setServerEnabled,
      setThreadModelParams,
      updateModelParameter,
    ]
  )

  if (strictedThread && !activeThread) {
    return null
  }

  const selectedModelLoading =
    stateModel.model === selectedModel?.id && stateModel.loading

  return (
    <div
      className={twMerge(
        'relative w-full overflow-hidden rounded-md',
        stateModel.loading && 'pointer-events-none',
        selectedModelLoading && 'bg-blue-200 text-blue-600'
      )}
    >
      <Select
        value={selectedModel?.id}
        onValueChange={onValueSelected}
        disabled={serverEnabled}
      >
        <SelectTrigger className="relative w-full">
          <SelectValue placeholder="Choose model to start">
            {selectedModelLoading && (
              <div
                className="z-5 absolute left-0 top-0 h-full w-full rounded-md bg-blue-100/80"
                style={{ width: `${loader}%` }}
              />
            )}
            <span
              className={twMerge(
                'relative z-20',
                selectedModelLoading && 'font-medium'
              )}
            >
              {selectedModel?.name}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectContent
            className={twMerge(
              'right-2 block w-full min-w-[450px] pr-0',
              isTabActive === 1 && '[&_.select-scroll-down-button]:hidden'
            )}
          >
            <div className="relative px-2 py-2 dark:bg-secondary/50">
              <ul className="inline-flex w-full space-x-2 rounded-lg bg-zinc-100 px-1 dark:bg-secondary">
                {engineOptions.map((name, i) => {
                  return (
                    <li
                      className={twMerge(
                        'relative my-1 flex w-full cursor-pointer items-center justify-center space-x-2 px-2 py-2',
                        isTabActive === i &&
                          'rounded-md bg-[hsla(var(--app-bg))] dark:bg-white'
                      )}
                      key={i}
                      onClick={() => setIsTabActive(i)}
                    >
                      {i === 0 ? (
                        <MonitorIcon
                          size={20}
                          className="text-[hsla(var(--app-text-secondary)] z-50"
                        />
                      ) : (
                        <GlobeIcon
                          size={20}
                          className="text-[hsla(var(--app-text-secondary)] z-50"
                        />
                      )}
                      <span
                        className={twMerge(
                          'text-[hsla(var(--app-text-secondary)] relative z-50 font-medium',
                          isTabActive === i &&
                            'font-bold text-foreground dark:text-black'
                        )}
                      >
                        {name}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="border-b border-[hsla(var(--app-border))]" />

            <SelectGroup className="py-2">
              <>
                {modelOptions.length === 0 ? (
                  <div className="px-4 py-2">
                    <p>{`Oops, you don't have a model yet.`}</p>
                  </div>
                ) : (
                  modelOptions.map((x, i) => (
                    <div
                      key={i}
                      className={twMerge(
                        x.id === selectedModel?.id && 'bg-secondary',
                        'hover:bg-secondary'
                      )}
                    >
                      <SelectItem
                        value={x.id}
                        className={twMerge(
                          x.id === selectedModel?.id && 'bg-secondary',
                          'my-0 py-2'
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-x-4">
                          <div className="max-w-[200px]">
                            <p className="line-clamp-2">{x.name}</p>
                            <div
                              className={twMerge(
                                'text-[hsla(var(--app-text-secondary)] mt-2 inline-flex items-center space-x-2'
                              )}
                            >
                              <p className="line-clamp-2 text-xs">{x.id}</p>
                            </div>
                          </div>
                          <div className="flex-shrink-0 space-x-2">
                            <span className="text-[hsla(var(--app-text-secondary)] font-bold">
                              {toGibibytes(x.metadata.size)}
                            </span>
                            {x.metadata.size && (
                              <ModelLabel metadata={x.metadata} />
                            )}
                          </div>
                        </div>
                      </SelectItem>
                      <div
                        className={twMerge(
                          'text-[hsla(var(--app-text-secondary)] absolute -mt-6 ml-4 flex max-w-[200px] items-center space-x-2'
                        )}
                      >
                        <p className="line-clamp-1 flex-1 text-xs text-transparent">
                          {x.id}
                        </p>
                        {clipboard.copied && copyId === x.id ? (
                          <CheckIcon size={16} className="text-green-600" />
                        ) : (
                          <CopyIcon
                            size={16}
                            className="z-20 cursor-pointer"
                            onClick={() => {
                              clipboard.copy(x.id)
                              setCopyId(x.id)
                            }}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
              </>
            </SelectGroup>
            <div className="border-b border-[hsla(var(--app-border))]" />
            <div className="flex w-full space-x-2 px-4 py-2">
              <Button
                block
                themes="secondary"
                onClick={() => setMainViewState(MainViewState.Settings)}
              >
                <FoldersIcon size={20} className="mr-2" />
                <span>My Models</span>
              </Button>
              <Button
                block
                className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
                onClick={() => setMainViewState(MainViewState.Hub)}
              >
                <LayoutGridIcon size={20} className="mr-2" />
                <span>Explore The Hub</span>
              </Button>
            </div>
          </SelectContent>
        </SelectPortal>
      </Select>
    </div>
  )
}

export default DropdownListSidebar
