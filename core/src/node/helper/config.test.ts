import { getAppConfigurations, defaultAppConfig } from './config'

import { getJanExtensionsPath, getJanDataFolderPath } from './config'

it('should return default config when CI is e2e', () => {
  process.env.CI = 'e2e'
  const config = getAppConfigurations()
  expect(config).toEqual(defaultAppConfig())
})

it('should return extensions path when retrieved successfully', () => {
  const extensionsPath = getJanExtensionsPath()
  expect(extensionsPath).not.toBeUndefined()
})

it('should return data folder path when retrieved successfully', () => {
  const dataFolderPath = getJanDataFolderPath()
  expect(dataFolderPath).not.toBeUndefined()
})
