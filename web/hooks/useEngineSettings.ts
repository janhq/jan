import { join } from 'path'

import { fs } from '@janhq/core'

export const useEngineSettings = () => {
  const readOpenAISettings = async () => {
    if (!fs.existsSync(join('file://engines', 'openai.json'))) return {}
    const settings = await fs.readFileSync(
      join('file://engines', 'openai.json'),
      'utf-8'
    )
    if (settings) {
      return typeof settings === 'object' ? settings : JSON.parse(settings)
    }
    return {}
  }
  const saveOpenAISettings = async ({
    apiKey,
  }: {
    apiKey: string | undefined
  }) => {
    const settings = await readOpenAISettings()
    settings.api_key = apiKey
    await fs.writeFileSync(
      join('file://engines', 'openai.json'),
      JSON.stringify(settings)
    )
  }
  return { readOpenAISettings, saveOpenAISettings }
}
