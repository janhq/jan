import { providerModels as models } from '@/constants/models'
import { ModelCapabilities } from '@/types/models'

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

/**
 * Build the canonical Hugging Face repo URL for a catalog model.
 *
 * `model_name` may already carry the org prefix — e.g. a repo pasted into the
 * hub as `https://huggingface.co/meta-llama/Llama-3.1-8B` is stored with
 * `model_name: 'meta-llama/Llama-3.1-8B'` and `developer: 'meta-llama'`
 * (see convertHfRepoToCatalogModel). The developer must only be prepended when
 * the org is missing, otherwise the "View on HuggingFace" link becomes
 * `meta-llama/meta-llama/Llama-3.1-8B` and 404s (#8634).
 */
export const getHuggingFaceUrl = (model: {
  model_name: string
  developer?: string
}): string => {
  if (model.model_name.includes('/')) {
    return `https://huggingface.co/${model.model_name}`
  }
  return `https://huggingface.co/${model.developer ? `${model.developer}/` : ''}${model.model_name}`
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
