import { generateText } from 'ai'
import { ModelFactory } from '@/lib/model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useServiceStore } from '@/hooks/useServiceHub'

export async function runParagraphEditCompletion(params: {
  system: string
  user: string
}): Promise<string> {
  const serviceHub = useServiceStore.getState().serviceHub
  const modelId = useModelProvider.getState().selectedModel?.id
  const providerId = useModelProvider.getState().selectedProvider
  const provider = useModelProvider.getState().getProviderByName(providerId)

  if (!serviceHub || !modelId || !provider) {
    throw new Error('No model selected or service is not ready.')
  }

  const inferenceParams =
    useAssistant.getState().currentAssistant?.parameters ?? {}

  const model = await ModelFactory.createModel(
    modelId,
    provider,
    inferenceParams
  )

  const { text } = await generateText({
    model,
    system: params.system,
    messages: [{ role: 'user', content: params.user }],
    abortSignal: params.abortSignal,
    maxOutputTokens: 4096,
  })

  return text
}
