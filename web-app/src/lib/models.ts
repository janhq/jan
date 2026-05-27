import { providerModels as models } from '@/constants/models'
import type {
  CatalogModel,
  MMProjModel,
  ModelQuant,
} from '@/services/models/types'
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

const FILE_SIZE_TO_BYTES: Record<'MB' | 'GB', number> = {
  MB: 1024 ** 2,
  GB: 1024 ** 3,
}

function parseCatalogFileSize(fileSize?: string): number | undefined {
  if (!fileSize) return undefined

  const match = fileSize.trim().match(/^([\d.]+)\s*(MB|GB)$/i)
  if (!match) return undefined

  const value = Number(match[1])
  const unit = match[2].toUpperCase() as keyof typeof FILE_SIZE_TO_BYTES
  if (!Number.isFinite(value)) return undefined

  return value * FILE_SIZE_TO_BYTES[unit]
}

function formatCatalogFileSize(bytes?: number): string | undefined {
  if (!bytes || !Number.isFinite(bytes)) return undefined

  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  }

  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export function getPreferredMmprojModel(
  model: Pick<CatalogModel, 'mmproj_models'>
): MMProjModel | undefined {
  return (
    model.mmproj_models?.find(
      (mmproj) => mmproj.model_id.toLowerCase() === 'mmproj-f16'
    ) ?? model.mmproj_models?.[0]
  )
}

export function getTotalDownloadFileSize(
  model: Pick<CatalogModel, 'mmproj_models'>,
  variant?: Pick<ModelQuant, 'file_size'> | null
): string | undefined {
  const modelBytes = parseCatalogFileSize(variant?.file_size)
  const mmprojBytes = parseCatalogFileSize(
    getPreferredMmprojModel(model)?.file_size
  )

  if (modelBytes === undefined) {
    return variant?.file_size
  }

  return formatCatalogFileSize(modelBytes + (mmprojBytes ?? 0))
}

//* MLX: суммируем размер всех safetensors-шардов (HF часто режет на 00001-of-0000N)
export function getMlxTotalFileSize(
  model: Pick<CatalogModel, 'safetensors_files'>
): string | undefined {
  const files = model.safetensors_files
  if (!files || files.length === 0) return undefined

  let totalBytes = 0
  let parsedAny = false
  for (const file of files) {
    const bytes = parseCatalogFileSize(file.file_size)
    if (bytes !== undefined) {
      totalBytes += bytes
      parsedAny = true
    }
  }

  if (!parsedAny) {
    return files[0]?.file_size
  }

  return formatCatalogFileSize(totalBytes)
}

//* Hub / setup: рекомендованный repo id ↔ запись каталога.
//* Совпадение строго по полному `org/repo` (case-insensitive). Без fallback
//* по «хвосту» — иначе при коллизии (`unsloth/X` vs `lmstudio-community/X`)
//* recommended из одной орги молча резолвится в чужую модель.
export function findCatalogModelForRecommendedRepo(
  sources: readonly CatalogModel[],
  recommendedRepoId: string
): CatalogModel | undefined {
  if (!recommendedRepoId) return undefined
  const target = recommendedRepoId.toLowerCase()
  return sources.find((s) => s.model_name.toLowerCase() === target)
}

/**
 * Extract model name from repo path, e.g. https://huggingface.co/cortexso/tinyllama -> cortexso/tinyllama
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}
