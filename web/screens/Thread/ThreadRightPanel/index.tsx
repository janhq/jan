import { memo, useCallback, useMemo } from 'react'

import {
  InferenceEngine,
  SettingComponentProps,
  SliderComponentProps,
} from '@janhq/core'
import {
  Tabs,
  TabsContent,
  TextArea,
  Accordion,
  AccordionItem,
} from '@janhq/joi'

import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import CopyOverInstruction from '@/containers/CopyInstruction'
import EngineSetting from '@/containers/EngineSetting'
import ModelDropdown from '@/containers/ModelDropdown'

import ModelSetting from '@/containers/ModelSetting'
import RightPanelContainer from '@/containers/RightPanelContainer'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getConfigurationsData } from '@/utils/componentSettings'
import { isLocalEngine } from '@/utils/modelEngine'
import {
  extractInferenceParams,
  extractModelLoadParams,
} from '@/utils/modelParam'

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

const INFERENCE_SETTINGS = 'Inference Settings'
const MODEL_SETTINGS = 'Model Settings'
const ENGINE_SETTINGS = 'Engine Settings'

const ThreadRightPanel = () => {
  const activeThread = useAtomValue(activeThreadAtom)
  const activeModelParams = useAtomValue(getActiveThreadModelParamsAtom)
  const selectedModel = useAtomValue(selectedModelAtom)
  const [activeTabThreadRightPanel, setActiveTabThreadRightPanel] = useAtom(
    activeTabThreadRightPanelAtom
  )
  const { updateThreadMetadata } = useCreateNewThread()
  const experimentalFeature = useAtomValue(experimentalFeatureEnabledAtom)

  const isModelSupportRagAndTools =
    selectedModel?.engine === InferenceEngine.openai ||
    isLocalEngine(selectedModel?.engine as InferenceEngine)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const { stopModel } = useActiveModel()
  const { updateModelParameter } = useUpdateModelParameters()

  const settings = useMemo(() => {
    // runtime setting
    const modelRuntimeParams = extractInferenceParams(
      {
        ...selectedModel?.parameters,
        ...activeModelParams,
      },
      selectedModel?.parameters
    )
    const componentDataRuntimeSetting = getConfigurationsData(
      modelRuntimeParams,
      selectedModel
    ).filter((x) => x.key !== 'prompt_template')

    // engine setting
    const modelEngineParams = extractModelLoadParams(
      {
        ...selectedModel?.settings,
        ...activeModelParams,
      },
      selectedModel?.settings
    )
    const componentDataEngineSetting = getConfigurationsData(
      modelEngineParams,
      selectedModel
    ).filter((x) => x.key !== 'prompt_template' && x.key !== 'embedding')

    // the max value of max token has to follow context length
    const maxTokens = componentDataRuntimeSetting.find(
      (x) => x.key === 'max_tokens'
    )
    const contextLength = componentDataEngineSetting.find(
      (x) => x.key === 'ctx_len'
    )
    if (maxTokens && contextLength) {
      // replace maxToken to componentDataRuntimeSetting
      const updatedComponentDataRuntimeSetting: SettingComponentProps[] =
        componentDataRuntimeSetting.map((settingComponentProps) => {
          if (settingComponentProps.key !== 'max_tokens')
            return settingComponentProps
          const contextLengthValue = Number(contextLength.controllerProps.value)
          const maxTokenValue = Number(
            settingComponentProps.controllerProps.value
          )
          const controllerProps =
            settingComponentProps.controllerProps as SliderComponentProps
          const sliderProps: SliderComponentProps = {
            ...controllerProps,
            max: contextLengthValue,
            value: Math.min(maxTokenValue, contextLengthValue),
          }

          const updatedSettingProps: SettingComponentProps = {
            ...settingComponentProps,
            controllerProps: sliderProps,
          }
          return updatedSettingProps
        })

      return {
        runtimeSettings: updatedComponentDataRuntimeSetting,
        engineSettings: componentDataEngineSetting,
      }
    }

    return {
      runtimeSettings: componentDataRuntimeSetting,
      engineSettings: componentDataEngineSetting,
    }
  }, [activeModelParams, selectedModel])

  const promptTemplateSettings = useMemo(() => {
    const modelEngineParams = extractModelLoadParams({
      ...selectedModel?.settings,
      ...activeModelParams,
    })
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

  const resetModel = useDebouncedCallback(() => {
    stopModel()
  }, 300)

  const onValueChanged = useCallback(
    (key: string, value: string | number | boolean) => {
      if (!activeThread) {
        return
      }

      setEngineParamsUpdate(true)
      resetModel()

      updateModelParameter(activeThread, {
        params: { [key]: value },
      })

      if (
        activeThread.assistants[0].model.parameters?.max_tokens &&
        activeThread.assistants[0].model.settings?.ctx_len
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
    [activeThread, resetModel, setEngineParamsUpdate, updateModelParameter]
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
          ...(experimentalFeature
            ? [
                {
                  name: 'Tools',
                  value: 'tools',
                  disabled: !isModelSupportRagAndTools,
                  tooltipContent: 'Not supported for this model',
                },
              ]
            : []),
        ]}
        value={activeTabThreadRightPanel as string}
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
                autoResize
                onChange={onAssistantInstructionChanged}
              />
            </div>
            <CopyOverInstruction />
          </div>
        </TabsContent>
        <TabsContent value="model">
          <div className="flex flex-col gap-4 px-2 py-4">
            <ModelDropdown />
          </div>
          <Accordion defaultValue={[]}>
            {settings.runtimeSettings.length !== 0 && (
              <AccordionItem
                title={INFERENCE_SETTINGS}
                value={INFERENCE_SETTINGS}
              >
                <ModelSetting
                  componentProps={settings.runtimeSettings}
                  onValueChanged={onValueChanged}
                />
              </AccordionItem>
            )}

            {promptTemplateSettings.length !== 0 && (
              <AccordionItem title={MODEL_SETTINGS} value={MODEL_SETTINGS}>
                <PromptTemplateSetting componentData={promptTemplateSettings} />
              </AccordionItem>
            )}

            {settings.engineSettings.length !== 0 && (
              <AccordionItem title={ENGINE_SETTINGS} value={ENGINE_SETTINGS}>
                <EngineSetting
                  componentData={settings.engineSettings}
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
