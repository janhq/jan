/**
 * Model Factory
 *
 * This factory provides a unified interface for creating language models from various providers.
 * It handles the complexity of initializing different AI SDK providers with their specific
 * configurations and returns a standard LanguageModel interface.
 *
 * Supported Providers:
 * - llamacpp: Local models via llama.cpp (requires running session)
 * - anthropic: Claude models via Anthropic API (@ai-sdk/anthropic v2.0)
 * - google/gemini: Gemini models via Google Generative AI API (@ai-sdk/google v2.0)
 * - OpenAI-compatible: OpenAI, Azure, Groq, Together, Fireworks, DeepSeek, Mistral, Cohere, etc.
 *
 * Usage:
 * ```typescript
 * const model = await ModelFactory.createModel(modelId, provider)
 * ```
 *
 * The factory automatically:
 * - Handles provider-specific authentication and headers
 * - Manages llamacpp session discovery and connection
 * - Configures custom headers for each provider
 * - Returns a unified LanguageModel interface compatible with Vercel AI SDK
 */

import { type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { invoke } from '@tauri-apps/api/core'
import { SessionInfo } from '@janhq/core'

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
 * Factory for creating language models based on provider type.
 * Supports native AI SDK providers (Anthropic, Google) and OpenAI-compatible providers.
 */
export class ModelFactory {
  /**
   * Create a language model instance based on the provider configuration
   */
  static async createModel(
    modelId: string,
    provider: ProviderObject
  ): Promise<LanguageModel> {
    const providerName = provider.provider.toLowerCase()

    switch (providerName) {
      case 'llamacpp':
        return this.createLlamaCppModel(modelId)

      case 'anthropic':
        return this.createAnthropicModel(modelId, provider)

      case 'google':
      case 'gemini':
        return this.createGoogleModel(modelId, provider)

      case 'openai':
      case 'azure':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'deepseek':
      case 'mistral':
      case 'cohere':
      case 'perplexity':
      case 'moonshot':
      default:
        return this.createOpenAICompatibleModel(modelId, provider)
    }
  }

  /**
   * Create a llamacpp model by finding the running session
   */
  private static async createLlamaCppModel(
    modelId: string
  ): Promise<LanguageModel> {
    // Get session info which includes port and api_key
    const sessionInfo = await invoke<SessionInfo | null>(
      'plugin:llamacpp|find_session_by_model',
      { modelId }
    )

    if (!sessionInfo) {
      throw new Error(`No running session found for model: ${modelId}`)
    }

    // Create OpenAI-compatible client for llamacpp
    const openAICompatible = createOpenAICompatible({
      name: 'llamacpp',
      baseURL: `http://localhost:${sessionInfo.port}/v1`,
      headers: {
        Authorization: `Bearer ${sessionInfo.api_key}`,
        Origin: 'tauri://localhost',
      },
      includeUsage: true,
    })

    return openAICompatible.languageModel(modelId, {
      metadataExtractor: llamaCppMetadataExtractor,
    })
  }

  /**
   * Create an Anthropic model using the official AI SDK
   */
  private static createAnthropicModel(
    modelId: string,
    provider: ProviderObject
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified (e.g., anthropic-version)
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const anthropic = createAnthropic({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

    return anthropic(modelId)
  }

  /**
   * Create a Google/Gemini model using the official AI SDK
   */
  private static createGoogleModel(
    modelId: string,
    provider: ProviderObject
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const google = createGoogleGenerativeAI({
      apiKey: provider.api_key,
      baseURL: provider.base_url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

    return google(modelId)
  }

  /**
   * Create an OpenAI-compatible model for providers that support the OpenAI API format
   */
  private static createOpenAICompatibleModel(
    modelId: string,
    provider: ProviderObject
  ): LanguageModel {
    const headers: Record<string, string> = {}

    // Add custom headers if specified
    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    // Add authorization header if api_key is present
    if (provider.api_key) {
      headers['Authorization'] = `Bearer ${provider.api_key}`
    }

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL: provider.base_url || 'https://api.openai.com/v1',
      headers,
      includeUsage: true,
    })

    return openAICompatible.languageModel(modelId)
  }
}
