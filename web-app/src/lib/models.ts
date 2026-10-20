import { providerModels as models } from '@/constants/models'
import { ModelCapabilities } from '@/types/models'

/** Filter discovery results only; persisted and manually entered model IDs stay intact. */
export const suggestedModelIds = (provider: string, ids: string[]): string[] => {
  const current =
    provider === 'minimax'
      ? models.minimax.models
      : provider === 'openrouter'
        ? ['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3']
        : undefined
  if (!current) return ids

  const textModel =
    provider === 'minimax' ? /^MiniMax-M\d/i : /^minimax\/minimax-m\d/i
  const currentIds: readonly string[] = current
  const filtered = ids.filter((id) => !textModel.test(id) || currentIds.includes(id))
  const preferred = filtered
    .filter((id) => textModel.test(id))
    .sort((a, b) => currentIds.indexOf(a) - currentIds.indexOf(b))
  // Reorder only MiniMax text slots, preserving other providers and media IDs.
  let index = 0
  return filtered.map((id) => textModel.test(id) ? preferred[index++] : id)
}

export const defaultModel = (provider?: string) => {
  if (!provider || !Object.keys(models).includes(provider)) {
    return models.openai.models[0]
  }
  return (
    models[provider as unknown as keyof typeof models]
      .models as unknown as string[]
  )[0]
}

/**
 * Determines model capabilities based on provider configuration from token.js
 * @param providerName - The provider name (e.g., 'openai', 'anthropic', 'openrouter')
 * @param modelId - The model ID to check capabilities for
 * @returns Array of model capabilities
 */
export const getModelCapabilities = (
  providerName: string,
  modelId: string
): string[] => {
  const providerConfig = models[providerName as unknown as keyof typeof models]

  const supportsToolCalls = Array.isArray(
    providerConfig?.supportsToolCalls as unknown
  )
    ? (providerConfig.supportsToolCalls as unknown as string[])
    : []

  const supportsImages = Array.isArray(
    providerConfig?.supportsImages as unknown
  )
    ? (providerConfig.supportsImages as unknown as string[])
    : []

  return [
    ModelCapabilities.COMPLETION,
    supportsToolCalls.includes(modelId) ? ModelCapabilities.TOOLS : undefined,
    supportsImages.includes(modelId) ? ModelCapabilities.VISION : undefined,
  ].filter(Boolean) as string[]
}

/**
 * This utility is to extract cortexso model description from README.md file
 * @returns
 */
export const extractDescription = (text?: string) => {
  if (!text) return text
  const normalizedText = removeYamlFrontMatter(text)
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = normalizedText?.match(overviewPattern)
  let extractedText =
    matches && matches[1]
      ? matches[1].trim()
      : normalizedText?.slice(0, 500).trim()

  // Remove image markdown syntax ![alt text](image-url)
  extractedText = extractedText?.replace(/!\[.*?\]\(.*?\)/g, '')

  // Remove <img> HTML tags
  extractedText = extractedText?.replace(/<img[^>]*>/g, '')

  return extractedText
}
/**
 * Remove YAML (HF metadata) front matter from content
 * @param content
 * @returns
 */
export const removeYamlFrontMatter = (content: string): string => {
  return content.replace(/^---\n([\s\S]*?)\n---\n/, '')
}

/**
 * Extract model name from repo path, e.g. cortexso/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

/**
 * Extract model name from repo path, e.g. https://huggingface.co/cortexso/tinyllama -> cortexso/tinyllama
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}

export const selectDefaultQuant = <T extends { model_id: string }>(
  quants: T[] | undefined,
  preferred: readonly string[]
): T | undefined => {
  if (!quants?.length) return undefined
  return (
    quants.find((q) =>
      preferred.some((p) => q.model_id.toLowerCase().includes(p))
    ) ?? quants[0]
  )
}

export const extractQuantLabel = (modelId?: string): string | null => {
  if (!modelId) return null
  const match = modelId.match(
    /(IQ\d+(?:_[A-Z0-9]+)+|Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32)(?:[-_.][^-_.]*)?$/i
  )
  return match ? match[1].toUpperCase() : null
}
