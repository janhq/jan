import fs from 'fs'
import path from 'path'
import { SettingComponentProps, getJanDataFolderPath } from '@janhq/core/node'

// Sec: Do not send engine settings over requests
// Read it manually instead
export const readEmbeddingEngine = (engineName: string) => {
  if (engineName !== 'openai' && engineName !== 'groq') {
    const engineSettings = fs.readFileSync(
      path.join(getJanDataFolderPath(), 'engines', `${engineName}.json`),
      'utf-8'
    )
    return JSON.parse(engineSettings)
  } else {
    const settingDirectoryPath = path.join(
      getJanDataFolderPath(),
      'settings',
      engineName === 'openai'
        ? 'inference-openai-extension'
        : 'inference-groq-extension',
      'settings.json'
    )

    const content = fs.readFileSync(settingDirectoryPath, 'utf-8')
    const settings: SettingComponentProps[] = JSON.parse(content)
    const apiKeyId = engineName === 'openai' ? 'openai-api-key' : 'groq-api-key'
    const keySetting = settings.find((setting) => setting.key === apiKeyId)

    let apiKey = keySetting?.controllerProps.value
    if (typeof apiKey !== 'string') apiKey = ''

    return {
      api_key: apiKey,
    }
  }
}
