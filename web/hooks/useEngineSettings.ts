import { fs, joinPath } from '@janhq/core'

export const useEngineSettings = () => {
  const readOpenAISettings = async () => {
    const settings = await fs.readFile(
      await joinPath(['engines', 'openai.json'])
    )
    if (settings) {
      return JSON.parse(settings)
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
    await fs.writeFile(
      await joinPath(['engines', 'openai.json']),
      JSON.stringify(settings)
    )
  }
  return { readOpenAISettings, saveOpenAISettings }
}
