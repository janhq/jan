import { useCallback } from 'react'

import { fs, joinPath, events, AppConfigurationEventName } from '@janhq/core'

export const useEngineSettings = () => {
  const readOpenAISettings = useCallback(async () => {
    if (
      !(await fs.existsSync(await joinPath(['file://engines', 'openai.json'])))
    )
      return {}
    const settings = await fs.readFileSync(
      await joinPath(['file://engines', 'openai.json']),
      'utf-8'
    )
    if (settings) {
      return typeof settings === 'object' ? settings : JSON.parse(settings)
    }
    return {}
  }, [])

  const saveOpenAISettings = async ({
    apiKey,
  }: {
    apiKey: string | undefined
  }) => {
    const settings = await readOpenAISettings()
    const settingFilePath = await joinPath(['file://engines', 'openai.json'])

    settings.api_key = apiKey

    await fs.writeFileSync(settingFilePath, JSON.stringify(settings))

    // Sec: Don't attach the settings data to the event
    events.emit(
      AppConfigurationEventName.OnConfigurationUpdate,
      settingFilePath
    )
  }
  return { readOpenAISettings, saveOpenAISettings }
}
