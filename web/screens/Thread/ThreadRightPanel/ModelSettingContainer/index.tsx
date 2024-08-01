import { Fragment, useCallback, useMemo } from 'react'

import { Model, SettingComponentProps, SliderComponentProps } from '@janhq/core'
import { Accordion, AccordionItem } from '@janhq/joi'
import { useAtomValue, useSetAtom } from 'jotai'

import { useDebouncedCallback } from 'use-debounce'

import EngineSetting from '@/containers/EngineSetting'
import ModelSetting from '@/containers/ModelSetting'

import useModelStop from '@/hooks/useModelStop'
import useModels from '@/hooks/useModels'

import { getConfigurationsData } from '@/utils/componentSettings'
import { toRuntimeParams, toSettingParams } from '@/utils/modelParam'

import { presetConfiguration } from '@/utils/predefinedComponent'

import PromptTemplateSetting from '../PromptTemplateSetting'

import {
  getSelectedModelAtom,
  updateSelectedModelAtom,
} from '@/helpers/atoms/Model.atom'

const ModelSettingContainer: React.FC = () => {
  const stopModel = useModelStop()
  const { updateModel } = useModels()
  const setSelectedModel = useSetAtom(updateSelectedModelAtom)

  const selectedModel = useAtomValue(getSelectedModelAtom)

  const modelSettings = useMemo(() => {
    if (!selectedModel) return
    // runtime setting
    const modelRuntimeParams = toRuntimeParams(selectedModel)
    const componentDataRuntimeSetting =
      getConfigurationsData(modelRuntimeParams)

    // engine setting
    const modelEngineParams = toSettingParams(selectedModel)
    const componentDataEngineSetting = getConfigurationsData(
      modelEngineParams
    ).filter((x) => x.key !== 'prompt_template' && x.key !== 'embedding')

    const promptTemplateSettings = getConfigurationsData(
      modelEngineParams
    ).filter((x) => x.key === 'prompt_template')

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
        promptTemplateSettings: promptTemplateSettings,
      }
    }

    return {
      runtimeSettings: componentDataRuntimeSetting,
      engineSettings: componentDataEngineSetting,
      promptTemplateSettings: promptTemplateSettings,
    }
  }, [selectedModel])

  // debounce update model via API 500 ms
  const debounceUpdateModel = useDebouncedCallback(
    (modelId: string, settings: Record<string, unknown>) => {
      updateModel(modelId, settings)
    },
    500
  )

  const onValueChanged = useCallback(
    async (key: string, value: string | number | boolean) => {
      if (!selectedModel) return

      const updatedModel: Model = {
        ...selectedModel,
        [key]: value,
      }
      if (key === 'stop') {
        updatedModel['stop'] = (value as string).split(' ')
      }

      setSelectedModel(updatedModel as Model)
      debounceUpdateModel(selectedModel.model, { ...updatedModel })

      const shouldStopModel =
        presetConfiguration[key]?.requireModelReload ?? true

      if (shouldStopModel) {
        stopModel.mutate(selectedModel.model)
      }
    },
    [selectedModel, debounceUpdateModel, stopModel, setSelectedModel]
  )

  if (!modelSettings) return null

  return (
    <Fragment>
      <Accordion defaultValue={[]}>
        {modelSettings.runtimeSettings.length !== 0 && (
          <AccordionItem
            title="Inference Parameters"
            value="Inference Parameters"
          >
            <ModelSetting
              componentProps={modelSettings.runtimeSettings}
              onValueChanged={onValueChanged}
            />
          </AccordionItem>
        )}

        {modelSettings.promptTemplateSettings.length !== 0 && (
          <AccordionItem title="Model Parameters" value="Model Parameters">
            <PromptTemplateSetting
              componentData={modelSettings.promptTemplateSettings}
              onValueChanged={onValueChanged}
            />
          </AccordionItem>
        )}

        {modelSettings.engineSettings.length !== 0 && (
          <AccordionItem title="Engine Parameters" value="Engine Parameters">
            <EngineSetting
              componentData={modelSettings.engineSettings}
              onValueChanged={onValueChanged}
            />
          </AccordionItem>
        )}
      </Accordion>
    </Fragment>
  )
}

export default ModelSettingContainer
