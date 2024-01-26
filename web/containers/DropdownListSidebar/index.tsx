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

import { MonitorIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useMainViewState } from '@/hooks/useMainViewState'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import { toGibibytes } from '@/utils/converter'

import ModelLabel from '../ModelLabel'
import OpenAiKeyInput from '../OpenAiKeyInput'

import { serverEnabledAtom } from '@/helpers/atoms/LocalServer.atom'

import {
  ModelParams,
  activeThreadAtom,
  setThreadModelParamsAtom,
  threadStatesAtom,
} from '@/helpers/atoms/Thread.atom'

export const selectedModelAtom = atom<Model | undefined>(undefined)

const DropdownListSidebar: React.FC = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

  const { stateModel } = useActiveModel()
  const [serverEnabled, setServerEnabled] = useAtom(serverEnabledAtom)
  const { setMainViewState } = useMainViewState()
  const [loader, setLoader] = useState(0)
  const { recommendedModel, downloadedModels } = useRecommendedModel()

  /**
   * Default value for max_tokens and ctx_len
   * Its to avoid OOM issue since a model can set a big number for these settings
   */
  const defaultValue = (value?: number) => {
    if (value && value < 4096) return value
    return 4096
  }

  useEffect(() => {
    if (!activeThread) return

    let model = downloadedModels.find(
      (model) => model.id === activeThread.assistants[0].model.id
    )
    if (!model) {
      model = recommendedModel
    }
    setSelectedModel(model)
    const finishInit = threadStates[activeThread.id].isFinishInit ?? true
    if (finishInit) return
    const modelParams: ModelParams = {
      ...model?.parameters,
      ...model?.settings,
      /**
       * This is to set default value for these settings instead of maximum value
       * Should only apply when model.json has these settings
       */
      ...(model?.parameters.max_tokens && {
        max_tokens: defaultValue(model?.parameters.max_tokens),
      }),
      ...(model?.settings.ctx_len && {
        ctx_len: defaultValue(model?.settings.ctx_len),
      }),
    }
    setThreadModelParams(activeThread.id, modelParams)
  }, [
    recommendedModel,
    activeThread,
    threadStates,
    downloadedModels,
    setThreadModelParams,
    setSelectedModel,
  ])

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
        setThreadModelParams(activeThread.id, modelParams)
      }
    },
    [
      downloadedModels,
      serverEnabled,
      activeThread,
      setSelectedModel,
      setServerEnabled,
      setThreadModelParams,
    ]
  )

  if (!activeThread) {
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
              <div className="flex w-full items-center space-x-2 px-4 py-2">
                <MonitorIcon size={20} className="text-muted-foreground" />
                <span>Local</span>
              </div>
              <div className="border-b border-border" />
              {downloadedModels.length === 0 ? (
                <div className="px-4 py-2">
                  <p>{`Oops, you don't have a model yet.`}</p>
                </div>
              ) : (
                <SelectGroup>
                  {downloadedModels.map((x, i) => (
                    <SelectItem
                      key={i}
                      value={x.id}
                      className={twMerge(
                        x.id === selectedModel?.id && 'bg-secondary'
                      )}
                    >
                      <div className="flex w-full justify-between">
                        <span className="line-clamp-1 block">{x.name}</span>
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
              <div className="w-full px-4 py-2">
                <Button
                  block
                  className="bg-blue-100 font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-600"
                  onClick={() => setMainViewState(MainViewState.Hub)}
                >
                  Explore The Hub
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
