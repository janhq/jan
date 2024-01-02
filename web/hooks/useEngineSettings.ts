import { fs, joinPath } from '@janhq/core'

export const useEngineSettings = () => {
  const readOpenAISettings = async () => {
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
  }
  const saveOpenAISettings = async ({
    apiKey,
  }: {
    apiKey: string | undefined
  }) => {
    const settings = await readOpenAISettings()
    settings.api_key = apiKey
    await fs.writeFileSync(
      await joinPath(['file://engines', 'openai.json']),
      JSON.stringify(settings)
    )
  }
  return { readOpenAISettings, saveOpenAISettings }
}
