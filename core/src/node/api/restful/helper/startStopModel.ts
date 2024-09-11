import { join } from 'path'
import { getJanDataFolderPath, getJanExtensionsPath, log } from '../../../helper'
import { ModelSettingParams } from '../../../../types'

/**
 * Start a model
 * @param modelId
 * @param settingParams
 * @returns
 */
export const startModel = async (modelId: string, settingParams?: ModelSettingParams) => {
  try {
    await runModel(modelId, settingParams)

    return {
      message: `Model ${modelId} started`,
    }
  } catch (e) {
    return {
      error: e,
    }
  }
}

/**
 * Run a model using installed cortex extension
 * @param model
 * @param settingParams
 */
const runModel = async (model: string, settingParams?: ModelSettingParams): Promise<void> => {
  const janDataFolderPath = getJanDataFolderPath()
  const modelFolder = join(janDataFolderPath, 'models', model)
  let module = join(
    getJanExtensionsPath(),
    '@janhq',
    'inference-cortex-extension',
    'dist',
    'node',
    'index.cjs'
  )
  // Just reuse the cortex extension implementation, don't duplicate then lost of sync
  return import(module).then((extension) =>
    extension
      .loadModel(
        {
          modelFolder,
          model,
        },
        settingParams
      )
      .then(() => log(`[SERVER]::Debug: Model is loaded`))
      .then({
        message: 'Model started',
      })
  )
}
/*
 * Stop model and kill nitro process.
 */
export const stopModel = async (_modelId: string) => {
  let module = join(
    getJanExtensionsPath(),
    '@janhq',
    'inference-cortex-extension',
    'dist',
    'node',
    'index.cjs'
  )
  // Just reuse the cortex extension implementation, don't duplicate then lost of sync
  return import(module).then((extension) =>
    extension
      .unloadModel()
      .then(() => log(`[SERVER]::Debug: Model is unloaded`))
      .then({
        message: 'Model stopped',
      })
  )
}
