import { ModelRuntimeParams, ModelSettingParams } from '@janhq/core'

import { ModelParams } from '@/helpers/atoms/Thread.atom'

export const toRuntimeParams = (
  modelParams?: ModelParams
): ModelRuntimeParams => {
  if (!modelParams) return {}
  const defaultModelParams: ModelRuntimeParams = {
    temperature: undefined,
    token_limit: undefined,
    top_k: undefined,
    top_p: undefined,
    stream: undefined,
    max_tokens: undefined,
    stop: undefined,
    frequency_penalty: undefined,
    presence_penalty: undefined,
  }

  const runtimeParams: ModelRuntimeParams = {}

  for (const [key, value] of Object.entries(modelParams)) {
    if (key in defaultModelParams) {
      Object.assign(runtimeParams, { ...runtimeParams, [key]: value })
    }
  }

  return runtimeParams
}

export const toSettingParams = (
  modelParams?: ModelParams
): ModelSettingParams => {
  if (!modelParams) return {}
  const defaultSettingParams: ModelSettingParams = {
    ctx_len: undefined,
    ngl: undefined,
    embedding: undefined,
    n_parallel: undefined,
    cpu_threads: undefined,
    prompt_template: undefined,
    llama_model_path: undefined,
    mmproj: undefined,
  }
  const settingParams: ModelSettingParams = {}

  for (const [key, value] of Object.entries(modelParams)) {
    if (key in defaultSettingParams) {
      Object.assign(settingParams, { ...settingParams, [key]: value })
    }
  }

  return settingParams
}
