import { ModelSettingParams } from '../../../../types'
import { CORTEX_DEFAULT_PORT, LOCAL_HOST } from './consts'

/**
 * Start a model
 * @param modelId
 * @param settingParams
 * @returns
 */
export const startModel = async (modelId: string, settingParams?: ModelSettingParams) => {
  return fetch(`http://${LOCAL_HOST}:${CORTEX_DEFAULT_PORT}/v1/models/start`, {
    method: 'POST',
    body: JSON.stringify({ model: modelId, ...settingParams }),
  })
}

/*
 * Stop model.
 */
export const stopModel = async (modelId: string) => {
  return fetch(`http://${LOCAL_HOST}:${CORTEX_DEFAULT_PORT}/v1/models/stop`, {
    method: 'POST',
    body: JSON.stringify({ model: modelId }),
  })
}
