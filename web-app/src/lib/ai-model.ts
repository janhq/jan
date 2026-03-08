import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

/**
 * Llama.cpp timings structure from the response
 */
interface LlamaCppTimings {
  prompt_n?: number
  predicted_n?: number
  predicted_per_second?: number
  prompt_per_second?: number
}

interface LlamaCppChunk {
  timings?: LlamaCppTimings
}

/**
 * Custom metadata extractor for llama.cpp that extracts timing information
 * and converts it to token usage format
 */
const llamaCppMetadataExtractor = {
  extractMetadata: async ({ parsedBody }: { parsedBody: unknown }) => {
    const body = parsedBody as LlamaCppChunk
    if (body?.timings) {
      return {
        llamacpp: {
          promptTokens: body.timings.prompt_n ?? null,
          completionTokens: body.timings.predicted_n ?? null,
          tokensPerSecond: body.timings.predicted_per_second ?? null,
          promptPerSecond: body.timings.prompt_per_second ?? null,
        },
      }
    }
    return undefined
  },
  createStreamExtractor: () => {
    let lastTimings: LlamaCppTimings | undefined

    return {
      processChunk: (parsedChunk: unknown) => {
        const chunk = parsedChunk as LlamaCppChunk
        if (chunk?.timings) {
          lastTimings = chunk.timings
        }
      },
      buildMetadata: () => {
        if (lastTimings) {
          return {
            llamacpp: {
              promptTokens: lastTimings.prompt_n ?? null,
              completionTokens: lastTimings.predicted_n ?? null,
              tokensPerSecond: lastTimings.predicted_per_second ?? null,
              promptPerSecond: lastTimings.prompt_per_second ?? null,
            },
          }
        }
        return undefined
      },
    }
  },
}

/**
 * Creates a LanguageModel instance for the AI SDK based on the provider configuration.
 * This allows using Jan's model providers with the AI SDK's useChat hook.
 *
 * Note: This function is synchronous and does not load the model or construct URLs.
 * URL construction should happen elsewhere after the model is ready.
 */
export function createLanguageModel(
  modelId: string,
  provider?: ModelProvider | null,
  providerObject?: ProviderObject | null
): LanguageModel {
  if (!provider) {
    throw new Error('Provider configuration is required')
  }

  // For llamacpp provider, create a placeholder configuration
  // The actual URL and authentication will be updated later when the model is loaded
  if (provider.provider === 'llamacpp' && providerObject) {
    // Create provider with placeholder connection info
    const openAICompatible = createOpenAICompatible({
      name: 'llamacpp',
      baseURL: 'http://localhost:1337/v1', // Placeholder - will be updated when model loads
      headers: {
        Authorization: 'Bearer placeholder', // Placeholder - will be updated when model loads
        Origin: 'tauri://localhost',
      },
      // Include usage data in streaming responses for token speed calculation
      includeUsage: true,
    })

    // Use languageModel with custom config to include metadata extractor for timings
    return openAICompatible.languageModel(modelId, {
      metadataExtractor: llamaCppMetadataExtractor,
    })
  }

  // For remote providers, use the configured base_url and api_key
  const openAICompatible = createOpenAICompatible({
    name: provider.provider,
    apiKey: provider.api_key ?? '',
    baseURL: provider.base_url ?? 'http://localhost:1337/v1',
    headers: {
      // Add Origin header for local providers
      ...(provider.base_url?.includes('localhost:') ||
      provider.base_url?.includes('127.0.0.1:')
        ? { Origin: 'tauri://localhost' }
        : {}),
      // OpenRouter identification headers
      ...(provider.provider === 'openrouter'
        ? {
            'HTTP-Referer': 'https://jan.ai',
            'X-Title': 'Jan',
          }
        : {}),
    },
    // Include usage data in streaming responses for token speed calculation
    includeUsage: true,
  })

  return openAICompatible(modelId)
}
