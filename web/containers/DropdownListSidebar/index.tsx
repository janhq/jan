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

import { motion as m } from 'framer-motion'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import {
  MonitorIcon,
  LayoutGridIcon,
  FoldersIcon,
  GlobeIcon,
  CopyIcon,
} from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useMainViewState } from '@/hooks/useMainViewState'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { toGibibytes } from '@/utils/converter'

import ModelLabel from '../ModelLabel'
import OpenAiKeyInput from '../OpenAiKeyInput'

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
  const { setMainViewState } = useMainViewState()
  const [loader, setLoader] = useState(0)
  const { recommendedModel, downloadedModels } = useRecommendedModel()
  const { updateModelParameter } = useUpdateModelParameters()

  const localModel = downloadedModels.filter(
    (model) => model.engine === InferenceEngine.nitro
  )
  const remoteModel = downloadedModels.filter(
    (model) => model.engine === InferenceEngine.openai
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
    if (stateModel.loading) {
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
  }, [stateModel.loading, loader])

  const onValueSelected = useCallback(
    async (modelId: string) => {
      const model = downloadedModels.find((m) => m.id === modelId)
      setSelectedModel(model)

      if (serverEnabled) {
        window.core?.api?.stopServer()
        setServerEnabled(false)
      }

      if (activeThread) {
        const modelParams = {
          ...model?.parameters,
          ...model?.settings,
        }
        // Update model paramter to the thread state
        setThreadModelParams(activeThread.id, modelParams)

        // Update model parameter to the thread file
        if (model)
          updateModelParameter(activeThread.id, {
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

  return (
    <>
      <div
        className={twMerge(
          'relative w-full overflow-hidden rounded-md',
          stateModel.loading && 'pointer-events-none bg-blue-200 text-blue-600'
        )}
      >
        <Select
          value={selectedModel?.id}
          onValueChange={onValueSelected}
          disabled={serverEnabled}
        >
          <SelectTrigger className="relative w-full">
            <SelectValue placeholder="Choose model to start">
              {stateModel.loading && (
                <div
                  className="z-5 absolute left-0 top-0 h-full w-full rounded-md bg-blue-100/80"
                  style={{ width: `${loader}%` }}
                />
              )}
              <span
                className={twMerge(
                  'relative z-20',
                  stateModel.loading && 'font-medium'
                )}
              >
                {selectedModel?.name}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent className="right-2  block w-full min-w-[450px] pr-0">
              <div className="relative px-2 py-2 dark:bg-secondary/50">
                <ul className="inline-flex w-full space-x-2 rounded-lg bg-zinc-100 px-1 dark:bg-secondary">
                  {engineOptions.map((name, i) => {
                    return (
                      <li
                        className="relative flex w-full cursor-pointer items-center justify-center space-x-2 px-2 py-2"
                        key={i}
                        onClick={() => setIsTabActive(i)}
                      >
                        {i === 0 ? (
                          <MonitorIcon
                            size={20}
                            className="z-50 text-muted-foreground"
                          />
                        ) : (
                          <GlobeIcon
                            size={20}
                            className="z-50 text-muted-foreground"
                          />
                        )}
                        <span
                          className={twMerge(
                            'relative z-50 font-medium text-muted-foreground',
                            isTabActive === i &&
                              'font-bold text-foreground dark:text-black'
                          )}
                        >
                          {name}
                        </span>
                        {isTabActive === i && (
                          <m.div
                            className="absolute -left-2 top-1 h-[calc(100%-8px)] w-full rounded-md bg-background dark:bg-white"
                            layoutId="dropdown-state-active"
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>

              <div className="border-b border-border" />
              {downloadedModels.length === 0 ? (
                <div className="px-4 py-2">
                  <p>{`Oops, you don't have a model yet.`}</p>
                </div>
              ) : (
                <SelectGroup>
                  {modelOptions.map((x, i) => (
                    <SelectItem
                      key={i}
                      value={x.id}
                      className={twMerge(
                        x.id === selectedModel?.id && 'bg-secondary'
                      )}
                    >
                      <div className="flex w-full justify-between">
                        <div className="flex flex-col">
                          <span className="line-clamp-1 block">{x.name}</span>
                          <div className="relative mt-1 flex items-center space-x-2 text-muted-foreground">
                            <span>{x.id}</span>
                            <CopyIcon
                              size={16}
                              className="absolute right-0 z-20"
                              onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                console.log('hh')
                              }}
                            />
                          </div>
                        </div>
                        <div className="space-x-2">
                          <span className="font-bold text-muted-foreground">
                            {toGibibytes(x.metadata.size)}
                          </span>
                          {x.engine == InferenceEngine.nitro && (
                            <ModelLabel size={x.metadata.size} />
                          )}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <div className="border-b border-border" />
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

      <OpenAiKeyInput />
    </>
  )
}

export default DropdownListSidebar
