import { models } from 'token.js'

export const defaultModel = (provider?: string) => {
  if (!provider || !Object.keys(models).includes(provider)) {
    return models.openai.models[0]
  }
  return (
    models[provider as unknown as keyof typeof models]
      .models as unknown as string[]
  )[0]
}
