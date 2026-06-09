import { modelSettings } from '@/lib/predefined'

export type ModelReasoningValue = string | number | boolean

export type ModelReasoningOption = {
  value: ModelReasoningValue
  label: string
  title?: string
}

export const DEFAULT_MODEL_REASONING_OPTIONS: ReadonlyArray<ModelReasoningOption> =
  [
    {
      value: 'auto',
      label: 'Auto',
      title: "Auto-detect from the model's chat template.",
    },
    {
      value: 'on',
      label: 'On',
      title: 'Force reasoning on for every request.',
    },
    {
      value: 'off',
      label: 'Off',
      title: 'Disable reasoning for every request.',
    },
  ]

export function getModelReasoningSetting(
  model?: Pick<Model, 'settings'> | null
): ProviderSetting | null {
  const setting = model?.settings?.reasoning
  if (!setting || setting.controller_type !== 'dropdown') return null
  return setting
}

export function getModelReasoningOptions(
  model?: Pick<Model, 'settings'> | null
): ModelReasoningOption[] {
  const setting = getModelReasoningSetting(model)
  if (!setting) return []

  const options = setting.controller_props?.options
  if (!Array.isArray(options) || options.length === 0) return []

  return options.map((option) => ({
    value: option.value,
    label: String(option.name ?? option.value),
    title: setting.description,
  }))
}

export function isDefaultReasoningSetting(setting: ProviderSetting): boolean {
  const defaultSetting = modelSettings.reasoning
  const defaultOptions = defaultSetting.controller_props?.options ?? []
  const currentOptions = setting.controller_props?.options ?? []

  if (setting.key !== defaultSetting.key) return false
  if (currentOptions.length !== defaultOptions.length) return false

  return currentOptions.every((option, index) => {
    const baseline = defaultOptions[index]
    return (
      option.value === baseline?.value && String(option.name) === String(baseline?.name)
    )
  })
}

export function getModelReasoningValue(
  model?: Pick<Model, 'settings'> | null
): ModelReasoningValue | undefined {
  const setting = getModelReasoningSetting(model)
  const options = getModelReasoningOptions(model)
  if (!setting || options.length === 0) return undefined

  const current = setting.controller_props?.value
  if (current !== undefined && options.some((option) => option.value === current)) {
    return current
  }

  return options[0]?.value
}

export function getModelReasoningLabel(
  model?: Pick<Model, 'settings'> | null
): string | undefined {
  const value = getModelReasoningValue(model)
  if (value === undefined) return undefined
  return (
    getModelReasoningOptions(model).find((option) => option.value === value)
      ?.label ?? String(value)
  )
}

export function modelSupportsReasoningControl(
  model?: Pick<Model, 'id' | 'embedding' | 'settings'> | null
): boolean {
  if (!model?.id || model.embedding) return false
  return getModelReasoningOptions(model).length > 0
}

export function buildModelReasoningSetting(
  existing: ProviderSetting | undefined,
  value: ModelReasoningValue
): ProviderSetting {
  const base = existing ?? modelSettings.reasoning
  return {
    ...base,
    controller_props: {
      ...(base.controller_props ?? {}),
      value,
    },
  }
}

export function applyModelReasoningUpdate(
  provider: ModelProvider,
  modelId: string,
  value: ModelReasoningValue
): ModelProvider | null {
  const modelIndex = provider.models.findIndex((m) => m.id === modelId)
  if (modelIndex === -1) return null

  const target = provider.models[modelIndex]
  const updatedModel = {
    ...target,
    settings: {
      ...target.settings,
      reasoning: buildModelReasoningSetting(target.settings?.reasoning, value),
    },
  } as Model

  const updatedModels = [...provider.models]
  updatedModels[modelIndex] = updatedModel

  return {
    ...provider,
    models: updatedModels,
  }
}

export function toLlamacppReasoningMode(
  value: ModelReasoningValue | undefined
): 'auto' | 'on' | 'off' | undefined {
  if (value === 'auto' || value === 'on' || value === 'off') return value
  return undefined
}