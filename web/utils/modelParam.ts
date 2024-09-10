/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { ModelRuntimeParams, ModelSettingParams } from '@janhq/core'

import { ModelParams } from '@/helpers/atoms/Thread.atom'

/**
 * Validation rules for model parameters
 */
export const validationRules: { [key: string]: (value: any) => boolean } = {
  temperature: (value: any) =>
    typeof value === 'number' && value >= 0 && value <= 1,
  token_limit: (value: any) => Number.isInteger(value) && value >= 0,
  top_k: (value: any) => typeof value === 'number' && value >= 0 && value <= 1,
  top_p: (value: any) => typeof value === 'number' && value >= 0 && value <= 1,
  stream: (value: any) => typeof value === 'boolean',
  max_tokens: (value: any) => Number.isInteger(value) && value >= 0,
  stop: (value: any) =>
    Array.isArray(value) && value.every((v) => typeof v === 'string'),
  frequency_penalty: (value: any) =>
    typeof value === 'number' && value >= 0 && value <= 1,
  presence_penalty: (value: any) =>
    typeof value === 'number' && value >= 0 && value <= 1,

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
 * Extract inference parameters from flat model parameters
 * @param modelParams
 * @returns
 */
export const extractRuntimeParams = (
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
      const validate = validationRules[key]
      if (validate && !validate(value)) {
        console.error(`Invalid value for ${key}: ${value}`)
        continue
      }
      Object.assign(runtimeParams, { ...runtimeParams, [key]: value })
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
    vision_model: undefined,
    text_model: undefined,
  }
  const settingParams: ModelSettingParams = {}

  for (const [key, value] of Object.entries(modelParams)) {
    if (key in defaultSettingParams) {
      const validate = validationRules[key]
      if (validate && !validate(value)) {
        console.error(`Invalid value for ${key}: ${value}`)
        continue
      }
      Object.assign(settingParams, { ...settingParams, [key]: value })
    }
  }

  return settingParams
}
