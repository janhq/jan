import { AppConfiguration } from '@janhq/core'

/**
 * Update app distinct Id
 * @param id
 */
export const updateDistinctId = async (id: string) => {
  const appConfiguration: AppConfiguration =
    await window.core?.api?.getAppConfigurations()
  appConfiguration.distinct_id = id
  await window.core?.api?.updateAppConfiguration(appConfiguration)
}

/**
 * Retrieve app distinct Id
 * @param id
 */
export const getAppDistinctId = async (): Promise<string | undefined> => {
  const appConfiguration: AppConfiguration =
    await window.core?.api?.getAppConfigurations()
  return appConfiguration.distinct_id
}
