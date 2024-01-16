import { useCallback, useEffect, useState } from 'react'

import {
  InferenceEngine,
  Model,
  ModelRuntimeParams,
  ModelSettingParams,
} from '@janhq/core'
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  TooltipArrow,
  Badge,
} from '@janhq/uikit'

import { atom, useAtomValue, useSetAtom } from 'jotai'

import { MonitorIcon, InfoIcon } from 'lucide-react'

import { twMerge } from 'tailwind-merge'

import { MainViewState } from '@/constants/screens'

import { useActiveModel } from '@/hooks/useActiveModel'

import { useEngineSettings } from '@/hooks/useEngineSettings'

import { useMainViewState } from '@/hooks/useMainViewState'

import useRecommendedModel from '@/hooks/useRecommendedModel'

import { toGibibytes } from '@/utils/converter'

import { totalRamAtom, usedRamAtom } from '@/helpers/atoms/SystemBar.atom'
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
  const setSelectedModel = useSetAtom(selectedModelAtom)
  const setThreadModelParams = useSetAtom(setThreadModelParamsAtom)
  const { activeModel } = useActiveModel()

  const [selected, setSelected] = useState<Model | undefined>()
  const { setMainViewState } = useMainViewState()
  const [openAISettings, setOpenAISettings] = useState<
    { api_key: string } | undefined
  >(undefined)
  const { readOpenAISettings, saveOpenAISettings } = useEngineSettings()
  const totalRam = useAtomValue(totalRamAtom)
  const usedRam = useAtomValue(usedRamAtom)

  useEffect(() => {
    readOpenAISettings().then((settings) => {
      setOpenAISettings(settings)
    })
  }, [])

  const { recommendedModel, downloadedModels } = useRecommendedModel()

  const selectedName =
    downloadedModels.filter((x) => x.id === selected?.id)[0]?.name ?? ''
  /**
   * Default value for max_tokens and ctx_len
   * Its to avoid OOM issue since a model can set a big number for these settings
   */
  const defaultValue = (value?: number) => {
    if (value && value < 4096) return value
    return 4096
  }

  useEffect(() => {
    setSelected(recommendedModel)
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
      setSelected(model)
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

  const getLabel = (size: number) => {
    const minimumRamModel = size * 1.25
    const availableRam = totalRam - usedRam + (activeModel?.metadata.size ?? 0)
    if (minimumRamModel > totalRam) {
      return (
        <Badge className="space-x-1 rounded-md" themes="danger">
          <span>Not enough RAM</span>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon size={16} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="right"
                sideOffset={10}
                className="max-w-[300px]"
              >
                <span>
                  {`This tag signals insufficient RAM for optimal model
                  performance. It's dynamic and may change with your system's
                  RAM availability.`}
                </span>
                <TooltipArrow />
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </Badge>
      )
    }
    if (minimumRamModel < availableRam) {
      return (
        <Badge className="space-x-1 rounded-md" themes="success">
          <span>Recommended</span>
        </Badge>
      )
    }
    if (minimumRamModel < totalRam && minimumRamModel > availableRam) {
      return (
        <Badge className="space-x-1 rounded-md" themes="warning">
          <span>Slow on your device</span>
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon size={16} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="right"
                sideOffset={10}
                className="max-w-[300px]"
              >
                <span>
                  This tag indicates that your current RAM performance may
                  affect model speed. It can change based on other active apps.
                  To improve, consider closing unnecessary applications to free
                  up RAM.
                </span>
                <TooltipArrow />
              </TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </Badge>
      )
    }
  }

  return (
    <>
      <Select value={selected?.id} onValueChange={onValueSelected}>
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
                  className={twMerge(x.id === selected?.id && 'bg-secondary')}
                >
                  <div className="flex w-full justify-between">
                    <span className="line-clamp-1 block">{x.name}</span>
                    <div className="space-x-2">
                      <span className="font-bold text-muted-foreground">
                        {toGibibytes(x.metadata.size)}
                      </span>
                      {x.engine == InferenceEngine.nitro &&
                        getLabel(x.metadata.size)}
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

      {selected?.engine === InferenceEngine.openai && (
        <div className="mt-4">
          <label
            id="thread-title"
            className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
          >
            API Key
          </label>
          <Input
            id="assistant-instructions"
            placeholder="Enter your API_KEY"
            defaultValue={openAISettings?.api_key}
            onChange={(e) => {
              saveOpenAISettings({ apiKey: e.target.value })
            }}
          />
        </div>
      )}
    </>
  )
}
