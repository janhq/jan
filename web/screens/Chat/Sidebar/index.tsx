import React, { useCallback, useMemo } from 'react'

import { Input, Textarea } from '@janhq/uikit'

import { atom, useAtomValue, useSetAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

import LogoMark from '@/containers/Brand/Logo/Mark'
import CardSidebar from '@/containers/CardSidebar'

import DropdownListSidebar, {
  selectedModelAtom,
} from '@/containers/DropdownListSidebar'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import EngineSetting from '../EngineSetting'
import ModelSetting from '../ModelSetting'

import AssistantTool from './AssistantTool'

import PromptTemplateSetting from './PromptTemplateSetting'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export const showRightSideBarAtom = atom<boolean>(true)

const Sidebar: React.FC = () => {
  const showing = useAtomValue(showRightSideBarAtom)
  const activeThread = useAtomValue(activeThreadAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const { updateThreadMetadata } = useCreateNewThread()

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const { stopModel } = useActiveModel()
  const { updateModelParameter } = useUpdateModelParameters()

  const modelSettings = useMemo(() => {
    const modelRuntimeParams = toRuntimeParams(activeModelParams)

    const componentDataRuntimeSetting = getConfigurationsData(
      modelRuntimeParams,
      selectedModel
    )
    return componentDataRuntimeSetting.filter(
      (x) => x.key !== 'prompt_template'
    )
  }, [activeModelParams, selectedModel])

  const engineSettings = useMemo(() => {
    const modelEngineParams = toSettingParams(activeModelParams)
    const componentDataEngineSetting = getConfigurationsData(
      modelEngineParams,
      selectedModel
    )
    return componentDataEngineSetting.filter((x) => x.key !== 'prompt_template')
  }, [activeModelParams, selectedModel])

  const promptTemplateSettings = useMemo(() => {
    const modelEngineParams = toSettingParams(activeModelParams)
    const componentDataEngineSetting = getConfigurationsData(
      modelEngineParams,
      selectedModel
    )
    return componentDataEngineSetting.filter((x) => x.key === 'prompt_template')
  }, [activeModelParams, selectedModel])

  const onThreadTitleChanged = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (activeThread)
        updateThreadMetadata({
          ...activeThread,
          title: e.target.value || '',
        })
    },
    [activeThread, updateThreadMetadata]
  )

  const onAssistantInstructionChanged = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (activeThread)
        updateThreadMetadata({
          ...activeThread,
          assistants: [
            {
              ...activeThread.assistants[0],
              instructions: e.target.value || '',
            },
          ],
        })
    },
    [activeThread, updateThreadMetadata]
  )

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!activeThread) {
        return
      }

      setEngineParamsUpdate(true)
      stopModel()

      updateModelParameter(activeThread, {
        params: { [key]: value },
      })
    },
    [activeThread, setEngineParamsUpdate, stopModel, updateModelParameter]
  )

  return (
    <div
      className={twMerge(
        'h-full flex-shrink-0 overflow-x-hidden border-l border-border bg-background pb-6 transition-all duration-100 dark:bg-background/20',
        showing
          ? 'w-80 translate-x-0 opacity-100'
          : 'w-0 translate-x-full opacity-0'
      )}
    >
      <div
        className={twMerge(
          'flex flex-col gap-1 delay-200',
          showing ? 'animate-enter opacity-100' : 'opacity-0'
        )}
      >
        <div className="flex flex-col space-y-4 p-4">
          <div>
            <label
              id="thread-title"
              className="mb-2 inline-block font-bold text-gray-600 dark:text-gray-300"
            >
              Title
            </label>
            <Input
              id="thread-title"
              value={activeThread?.title}
              onChange={onThreadTitleChanged}
            />
          </div>
          <div className="flex flex-col">
            <label
              id="thread-title"
              className="mb-2 inline-block font-bold text-zinc-500 dark:text-gray-300"
            >
              Threads ID
            </label>
            <span className="text-xs text-muted-foreground">
              {activeThread?.id || '-'}
            </span>
          </div>
        </div>

        <CardSidebar title="Assistant" isShow={true}>
          <div className="flex flex-col space-y-4 p-2">
            <div className="flex items-center space-x-2">
              <LogoMark width={24} height={24} />
              <span className="font-bold capitalize">
                {activeThread?.assistants[0].assistant_name ?? '-'}
              </span>
            </div>
            <div>
              <label
                id="thread-title"
                className="mb-2 inline-block font-bold text-zinc-500 dark:text-gray-300"
              >
                Instructions
              </label>
              <Textarea
                id="assistant-instructions"
                placeholder="Eg. You are a helpful assistant."
                value={activeThread?.assistants[0].instructions ?? ''}
                onChange={onAssistantInstructionChanged}
              />
            </div>
          </div>
        </CardSidebar>

        <CardSidebar title="Model" isShow={true}>
          <div className="flex flex-col gap-4 px-2 py-4">
            <DropdownListSidebar />

            {modelSettings.length > 0 && (
              <CardSidebar title="Inference Parameters" asChild>
                <div className="px-2 py-4">
                  <ModelSetting
                    componentProps={modelSettings}
                    onValueChanged={onValueChanged}
                  />
                </div>
              </CardSidebar>
            )}

            {promptTemplateSettings.length > 0 && (
              <CardSidebar title="Model Parameters" asChild>
                <div className="px-2 py-4">
                  <PromptTemplateSetting
                    componentData={promptTemplateSettings}
                  />
                </div>
              </CardSidebar>
            )}

            {engineSettings.length > 0 && (
              <CardSidebar title="Engine Parameters" asChild>
                <div className="px-2 py-4">
                  <EngineSetting
                    componentData={engineSettings}
                    onValueChanged={onValueChanged}
                  />
                </div>
              </CardSidebar>
            )}
          </div>
        </CardSidebar>

        <AssistantTool />
      </div>
    </div>
  )
}

export default React.memo(Sidebar)
