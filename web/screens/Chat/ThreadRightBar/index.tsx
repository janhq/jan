import { memo, useCallback, useMemo } from 'react'

import {
  ScrollArea,
  Tabs,
  TabsContent,
  TextArea,
  Accordion,
  AccordionItem,
} from '@janhq/joi'

import { atom, useAtomValue, useSetAtom } from 'jotai'

import { twMerge } from 'tailwind-merge'

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

import PromptTemplateSetting from './PromptTemplateSetting'
import Tools from './Tools'

import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

export const showRightSideBarAtom = atom<boolean>(true)

const ThreadRightBar = () => {
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
    return componentDataEngineSetting.filter(
      (x) => x.key !== 'prompt_template' && x.key !== 'embedding'
    )
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

      if (
        activeThread.assistants[0].model.parameters.max_tokens &&
        activeThread.assistants[0].model.settings.ctx_len
      ) {
        if (
          key === 'max_tokens' &&
          Number(value) > activeThread.assistants[0].model.settings.ctx_len
        ) {
          updateModelParameter(activeThread, {
            params: {
              max_tokens: activeThread.assistants[0].model.settings.ctx_len,
            },
          })
        }
        if (
          key === 'ctx_len' &&
          Number(value) < activeThread.assistants[0].model.parameters.max_tokens
        ) {
          updateModelParameter(activeThread, {
            params: {
              max_tokens: activeThread.assistants[0].model.settings.ctx_len,
            },
          })
        }
      }
    },
    [activeThread, setEngineParamsUpdate, stopModel, updateModelParameter]
  )

  return (
    <ScrollArea
      className={twMerge(
        'h-full flex-shrink-0 border-l border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] transition-all duration-100 dark:bg-[hsla(var(--app-bg))]/20',
        showing
          ? 'w-[250px] translate-x-0 opacity-100'
          : 'w-0 translate-x-full opacity-0'
      )}
    >
      <Tabs
        options={[
          { name: 'Assistant', value: 'assistant' },
          { name: 'Model', value: 'model' },
          { name: 'Tools', value: 'tools' },
        ]}
        defaultValue="assistant"
      >
        <TabsContent value="assistant">
          <div className="flex flex-col space-y-4 p-4">
            <div>
              <label id="thread-title" className="mb-2 inline-block font-bold">
                Instructions
              </label>
              <TextArea
                id="assistant-instructions"
                placeholder="Eg. You are a helpful assistant."
                value={activeThread?.assistants[0].instructions ?? ''}
                onChange={onAssistantInstructionChanged}
              />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="model">
          <div className="flex flex-col gap-4 px-2 py-4">
            <DropdownListSidebar />
          </div>

          <Accordion defaultValue={['Inference Parameters']}>
            <AccordionItem
              title="Inference Parameters"
              value="Inference Parameters"
            >
              <ModelSetting
                componentProps={modelSettings}
                onValueChanged={onValueChanged}
              />
            </AccordionItem>
            <AccordionItem title="Model Parameters" value="Model Parameters">
              <PromptTemplateSetting componentData={promptTemplateSettings} />
            </AccordionItem>
            <AccordionItem title="Engine Parameters" value="Engine Parameters">
              <EngineSetting
                componentData={engineSettings}
                onValueChanged={onValueChanged}
              />
            </AccordionItem>
          </Accordion>
        </TabsContent>
        <TabsContent value="tools">
          <Tools />
        </TabsContent>
      </Tabs>
    </ScrollArea>
  )
}

export default memo(ThreadRightBar)
