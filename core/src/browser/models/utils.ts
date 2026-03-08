/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { ModelParams, ModelRuntimeParams, ModelSettingParams } from '../../types'

/**
 * Validation rules for model parameters
 */
export const validationRules: { [key: string]: (value: any) => boolean } = {
  temperature: (value: any) => typeof value === 'number' && value >= 0 && value <= 2,
  token_limit: (value: any) => Number.isInteger(value) && value >= 0,
  top_k: (value: any) => typeof value === 'number' && value >= 0,
  top_p: (value: any) => typeof value === 'number' && value >= 0 && value <= 1,
  stream: (value: any) => typeof value === 'boolean',
  max_tokens: (value: any) => Number.isInteger(value) && value >= 0,
  stop: (value: any) => Array.isArray(value) && value.every((v) => typeof v === 'string'),
  frequency_penalty: (value: any) => typeof value === 'number' && value >= -2 && value <= 2,
  presence_penalty: (value: any) => typeof value === 'number' && value >= -2 && value <= 2,
  repeat_last_n: (value: any) => typeof value === 'number',
  repeat_penalty: (value: any) => typeof value === 'number',
  min_p: (value: any) => typeof value === 'number',

  ctx_len: (value: any) => Number.isInteger(value) && value >= 0,
  ngl: (value: any) => Number.isInteger(value) && value >= 0,
  embedding: (value: any) => typeof value === 'boolean',
  n_parallel: (value: any) => Number.isInteger(value) && value >= 0,
  cpu_threads: (value: any) => Number.isInteger(value) && value >= 0,
  prompt_template: (value: any) => typeof value === 'string',
  llama_model_path: (value: any) => typeof value === 'string',
  mmproj: (value: any) => typeof value === 'string',
  vision_model: (value: any) => typeof value === 'boolean',
  text_model: (value: any) => typeof value === 'boolean',
}

/**
 * There are some parameters that need to be normalized before being sent to the server
 * E.g. ctx_len should be an integer, but it can be a float from the input field
 * @param key
 * @param value
 * @returns
 */
export const normalizeValue = (key: string, value: any) => {
  if (
    key === 'token_limit' ||
    key === 'max_tokens' ||
    key === 'ctx_len' ||
    key === 'ngl' ||
    key === 'n_parallel' ||
    key === 'cpu_threads'
  ) {
    // Convert to integer
    return Math.floor(Number(value))
  }
  if (
    key === 'temperature' ||
    key === 'top_k' ||
    key === 'top_p' ||
    key === 'min_p' ||
    key === 'repeat_penalty' ||
    key === 'frequency_penalty' ||
    key === 'presence_penalty' ||
    key === 'repeat_last_n'
  ) {
    // Convert to float
    const newValue = parseFloat(value)
    if (newValue !== null && !isNaN(newValue)) {
      return newValue
    }
  }
  return value
}

/**
 * Extract inference parameters from flat model parameters
 * @param modelParams
 * @returns
 */
export const extractInferenceParams = (
  modelParams?: ModelParams,
  originParams?: ModelParams
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
    engine: undefined,
  }

  const runtimeParams: ModelRuntimeParams = {}

  for (const [key, value] of Object.entries(modelParams)) {
    if (key in defaultModelParams) {
      const validate = validationRules[key]
      if (validate && !validate(normalizeValue(key, value))) {
        // Invalid value - fall back to origin value
        if (originParams && key in originParams) {
          Object.assign(runtimeParams, {
            ...runtimeParams,
            [key]: originParams[key as keyof typeof originParams],
          })
        }
      } else {
        Object.assign(runtimeParams, {
          ...runtimeParams,
          [key]: normalizeValue(key, value),
        })
      }
    }
  }

  return runtimeParams
}

/**
 * Extract model load parameters from flat model parameters
 * @param modelParams
 * @returns
 */
export const extractModelLoadParams = (
  modelParams?: ModelParams,
  originParams?: ModelParams
): ModelSettingParams => {
  if (!modelParams) return {}
  const defaultSettingParams: ModelSettingParams = {
    ctx_len: undefined,
    ngl: undefined,
    embedding: undefined,
    n_parallel: undefined,
    cpu_threads: undefined,
    pre_prompt: undefined,
    system_prompt: undefined,
    ai_prompt: undefined,
    user_prompt: undefined,
    prompt_template: undefined,
    model_path: undefined,
    llama_model_path: undefined,
    mmproj: undefined,
    cont_batching: undefined,
    vision_model: undefined,
    text_model: undefined,
    engine: undefined,
    top_p: undefined,
    top_k: undefined,
    min_p: undefined,
    temperature: undefined,
    repeat_penalty: undefined,
    repeat_last_n: undefined,
    presence_penalty: undefined,
    frequency_penalty: undefined,
  }
  const settingParams: ModelSettingParams = {}

  for (const [key, value] of Object.entries(modelParams)) {
    if (key in defaultSettingParams) {
      const validate = validationRules[key]
      if (validate && !validate(normalizeValue(key, value))) {
        // Invalid value - fall back to origin value
        if (originParams && key in originParams) {
          Object.assign(modelParams, {
            ...modelParams,
            [key]: originParams[key as keyof typeof originParams],
          })
        }
      } else {
        Object.assign(settingParams, {
          ...settingParams,
          [key]: normalizeValue(key, value),
        })
      }
    }
  }

  return settingParams
}
