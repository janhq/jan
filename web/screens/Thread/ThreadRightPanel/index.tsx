import { memo, useCallback, useMemo } from 'react'

import {
  Tabs,
  TabsContent,
  TextArea,
  Accordion,
  AccordionItem,
} from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import EngineSetting from '@/containers/EngineSetting'
import ModelDropdown from '@/containers/ModelDropdown'

import ModelSetting from '@/containers/ModelSetting'
import RightPanelContainer from '@/containers/RightPanelContainer'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import PromptTemplateSetting from './PromptTemplateSetting'
import Tools from './Tools'

import { experimentalFeatureEnabledAtom } from '@/helpers/atoms/AppConfig.atom'
import { selectedModelAtom } from '@/helpers/atoms/Model.atom'
import {
  activeThreadAtom,
  engineParamsUpdateAtom,
  getActiveThreadModelParamsAtom,
} from '@/helpers/atoms/Thread.atom'

import { activeTabThreadRightPanelAtom } from '@/helpers/atoms/ThreadRightPanel.atom'

const ThreadRightPanel = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const [activeTabThreadRightPanel, setActiveTabThreadRightPanel] = useAtom(
    activeTabThreadRightPanelAtom
  )
  const { updateThreadMetadata } = useCreateNewThread()
  const experimentalFeature = useAtomValue(experimentalFeatureEnabledAtom)

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

  if (!activeThread) {
    return null
  }

  return (
    <RightPanelContainer>
      <Tabs
        options={[
          { name: 'Assistant', value: 'assistant' },
          { name: 'Model', value: 'model' },
          ...(experimentalFeature ? [{ name: 'Tools', value: 'tools' }] : []),
        ]}
        value={activeTabThreadRightPanel}
        onValueChange={(value) => setActiveTabThreadRightPanel(value)}
      >
        <TabsContent value="assistant">
          <div className="flex flex-col space-y-4 p-4">
            <div>
              <label
                id="assistant-instructions"
                className="mb-2 inline-block font-bold"
              >
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
            <ModelDropdown />
          </div>
          <Accordion defaultValue={[]}>
            {modelSettings.length !== 0 && (
              <AccordionItem
                title="Inference Parameters"
                value="Inference Parameters"
              >
                <ModelSetting
                  componentProps={modelSettings}
                  onValueChanged={onValueChanged}
                />
              </AccordionItem>
            )}

            {promptTemplateSettings.length !== 0 && (
              <AccordionItem title="Model Parameters" value="Model Parameters">
                <PromptTemplateSetting componentData={promptTemplateSettings} />
              </AccordionItem>
            )}

            {engineSettings.length !== 0 && (
              <AccordionItem
                title="Engine Parameters"
                value="Engine Parameters"
              >
                <EngineSetting
                  componentData={engineSettings}
                  onValueChanged={onValueChanged}
                />
              </AccordionItem>
            )}
          </Accordion>
        </TabsContent>
        <TabsContent value="tools">
          <Tools />
        </TabsContent>
      </Tabs>
    </RightPanelContainer>
  )
}

export default memo(ThreadRightPanel)
