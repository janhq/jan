import { useCallback, useEffect } from 'react'

import { InferenceEngine, Model } from '@janhq/core'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@janhq/uikit'

import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'

import { MonitorIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useMainViewState } from '@/hooks/useMainViewState'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import { toGibibytes } from '@/utils/converter'

import ModelLabel from '../ModelLabel'

import OpenAiKeyInput from '../OpenAiKeyInput'

import {
  ModelParams,
  activeThreadAtom,
  getActiveThreadIdAtom,
  setThreadModelParamsAtom,
  threadStatesAtom,
} from '@/helpers/atoms/Thread.atom'

export const selectedModelAtom = atom<Model | undefined>(undefined)

export default function DropdownListSidebar() {
  const activeThreadId = useAtomValue(getActiveThreadIdAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const threadStates = useAtomValue(threadStatesAtom)
  const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)

  const { setMainViewState } = useMainViewState()
  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const selectedName =
    downloadedModels.filter((x) => x.id === selectedModel?.id)[0]?.name ?? ''
  /**
   * Default value for max_tokens and ctx_len
   * Its to avoid OOM issue since a model can set a big number for these settings
   */
  const defaultValue = (value?: number) => {
    if (value && value < 4096) return value
    return 4096
  }

  useEffect(() => {
    setSelectedModel(recommendedModel)

    if (activeThread) {
      const finishInit = threadStates[activeThread.id].isFinishInit ?? true
      if (finishInit) return
      const modelParams: ModelParams = {
        ...recommendedModel?.parameters,
        ...recommendedModel?.settings,
        /**
         * This is to set default value for these settings instead of maximum value
         * Should only apply when model.json has these settings
         */
        ...(recommendedModel?.parameters.max_tokens && {
          max_tokens: defaultValue(recommendedModel?.parameters.max_tokens),
        }),
        ...(recommendedModel?.settings.ctx_len && {
          ctx_len: defaultValue(recommendedModel?.settings.ctx_len),
        }),
      }
      setThreadModelParams(activeThread.id, modelParams)
    }
  }, [
    recommendedModel,
    activeThread,
    setSelectedModel,
    setThreadModelParams,
    threadStates,
  ])

  const onValueSelected = useCallback(
    (modelId: string) => {
      const model = downloadedModels.find((m) => m.id === modelId)
      setSelectedModel(model)

      if (activeThreadId) {
        const modelParams = {
          ...model?.parameters,
          ...model?.settings,
        }
        setThreadModelParams(activeThreadId, modelParams)
      }
    },
    [downloadedModels, activeThreadId, setSelectedModel, setThreadModelParams]
  )

  if (!activeThread) {
    return null
  }

  return (
    <>
      <Select value={selectedModel?.id} onValueChange={onValueSelected}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose model to start">
            {selectedName}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="right-2 block w-full min-w-[450px] pr-0">
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
      </Select>

      <OpenAiKeyInput selectedModel={selectedModel} />
    </>
  )
}
