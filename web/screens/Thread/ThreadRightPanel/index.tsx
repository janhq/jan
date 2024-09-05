/* eslint-disable jsx-a11y/alt-text */
import { memo, useCallback, useMemo } from 'react'

import Image from 'next/image'

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
  Input,
} from '@janhq/joi'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'

import { UploadIcon } from 'lucide-react'

import CopyOverInstruction from '@/containers/CopyInstruction'
import EngineSetting from '@/containers/EngineSetting'
import ModelDropdown from '@/containers/ModelDropdown'

import ModelSetting from '@/containers/ModelSetting'
import RightPanelContainer from '@/containers/RightPanelContainer'

import { useActiveModel } from '@/hooks/useActiveModel'
import { useCreateNewThread } from '@/hooks/useCreateNewThread'

import useUpdateModelParameters from '@/hooks/useUpdateModelParameters'

import { getConfigurationsData } from '@/utils/componentSettings'
import { localEngines } from '@/utils/modelEngine'
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
    localEngines.includes(selectedModel?.engine as InferenceEngine)

  const setEngineParamsUpdate = useSetAtom(engineParamsUpdateAtom)
  const { stopModel } = useActiveModel()
  const { updateModelParameter } = useUpdateModelParameters()

  const settings = useMemo(() => {
    // runtime setting
    const modelRuntimeParams = toRuntimeParams(activeModelParams)
    const componentDataRuntimeSetting = getConfigurationsData(
      modelRuntimeParams,
      selectedModel
    ).filter((x) => x.key !== 'prompt_template')

    // engine setting
    const modelEngineParams = toSettingParams(activeModelParams)
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

  const onAssistantNameChanged = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (activeThread)
        updateThreadMetadata({
          ...activeThread,
          assistants: [
            {
              ...activeThread.assistants[0],
              assistant_name: e.target.value || '',
            },
          ],
        })
    },
    [activeThread, updateThreadMetadata]
  )

  const onAssistantAvatarChanged = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (activeThread && e.target.files && e.target.files[0]) {
        const file = e.target.files[0]
        const reader = new FileReader()
        reader.onloadend = () => {
          updateThreadMetadata({
            ...activeThread,
            assistants: [
              {
                ...activeThread.assistants[0],
                avatar: reader.result as string,
              },
            ],
          })
        }
        reader.readAsDataURL(file)
      }
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

  const avatar = activeThread?.assistants[0].avatar

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
          <div className="flex flex-col gap-4 px-4">
            <div className="mt-4">
              <label className="inline-block font-bold">Avatar</label>
              <div className="relative mt-2 h-16 w-16">
                {avatar ? (
                  <Image
                    src={avatar}
                    alt="avatar"
                    width={100}
                    height={100}
                    className="absolute h-full w-full rounded-full object-cover object-center"
                    priority
                  />
                ) : (
                  <Image
                    src={'/icons/app_icon.svg'}
                    alt="avatar"
                    width={100}
                    height={100}
                    className="absolute h-full w-full rounded-full border border-[hsla(var(--app-border))] object-cover object-center p-2"
                    priority
                  />
                )}
                <div className="absolute -bottom-2 -right-2 flex h-7 w-7 rounded-full border border-[hsla(var(--app-border))] bg-[hsla(var(--app-bg))] shadow">
                  <label
                    htmlFor="avatar-upload"
                    className="flex h-full w-full cursor-pointer items-center justify-center"
                  >
                    <UploadIcon
                      size={14}
                      className="text-[hsla(var(--text-secondary))]"
                    />
                  </label>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onAssistantAvatarChanged}
                  />
                </div>
              </div>
            </div>
            <div>
              <label
                id="assistant-instructions"
                className="mb-2 inline-block font-bold"
              >
                Name
              </label>
              <Input
                id="assistant-name"
                value={activeThread?.assistants[0].assistant_name ?? ''}
                onChange={onAssistantNameChanged}
              />
            </div>
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
                rows={8}
                onChange={onAssistantInstructionChanged}
              />
            </div>
            {experimentalFeature && <CopyOverInstruction />}
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
