import {
  Model,
  ModelRuntimeParams,
  ModelSettingParams,
  modelRuntimeParamsKeys,
  modelSettingParamsKeys,
} from '@janhq/core'

export const toRuntimeParams = (model: Model): ModelRuntimeParams => {
  const runtimeParams: ModelRuntimeParams = {}

  for (const [key, value] of Object.entries(model)) {
    if (modelRuntimeParamsKeys.includes(key as keyof ModelRuntimeParams)) {
      Object.assign(runtimeParams, { ...runtimeParams, [key]: value })
    }
  }
  return runtimeParams
}

export const toSettingParams = (model: Model): ModelSettingParams => {
  const settingParams: ModelSettingParams = {}

  for (const [key, value] of Object.entries(model)) {
    if (modelSettingParamsKeys.includes(key as keyof ModelSettingParams)) {
      Object.assign(settingParams, { ...settingParams, [key]: value })
    }
  }

  return settingParams
}
