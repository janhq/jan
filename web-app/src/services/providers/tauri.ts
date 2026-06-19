/**
 * Tauri Providers Service - Desktop implementation
 */

import { ensureRegistryLoaded } from '@/stores/provider-registry-store'
import { providerModels } from '@/constants/models'
import { EngineManager, SettingComponentProps } from '@janhq/core'
import { ModelCapabilities } from '@/types/models'
import { modelSettings } from '@/lib/predefined'
import { ExtensionManager } from '@/lib/extension'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import { DefaultProvidersService } from './default'
import { getModelCapabilities } from '@/lib/models'

export class TauriProvidersService extends DefaultProvidersService {
  fetch(): typeof fetch {
    // Tauri implementation uses Tauri's fetch to avoid CORS issues
    return fetchTauri as typeof fetch
  }

  async getProviders(): Promise<ModelProvider[]> {
    try {
      const registryProviders = await ensureRegistryLoaded()
      const builtinProviders = registryProviders
        .map((provider) => {
          let models = (provider.models ?? []) as Model[]

          // Registry is the canonical source for the cloud catalog. We only
          // synthesize models from the in-code `providerModels` lookup when the
          // registry hasn't supplied any (back-compat for older manifests).
          if (
            models.length === 0 &&
            Object.keys(providerModels).includes(provider.provider)
          ) {
            const builtInModels = providerModels[
              provider.provider as unknown as keyof typeof providerModels
            ].models as unknown as string[]

            if (Array.isArray(builtInModels)) {
              models = builtInModels.map(
                (model) =>
                  ({
                    id: model,
                    name: model,
                    capabilities: getModelCapabilities(provider.provider, model),
                  }) as Model
              )
            }
          }

          return {
            ...provider,
            models,
          }
        })
        .filter(Boolean)

      const runtimeProviders: ModelProvider[] = []
      for (const [providerName, value] of EngineManager.instance().engines) {
        const models = await value.list() ?? [] 
        const provider: ModelProvider = {
          active: false,
          persist: true,
          provider: providerName,
          base_url:
            'inferenceUrl' in value
              ? (value.inferenceUrl as string).replace('/chat/completions', '')
              : '',
          settings: (await value.getSettings()).map((setting) => {
            return {
              key: setting.key,
              title: setting.title,
              description: setting.description,
              controller_type: setting.controllerType as unknown,
              controller_props: setting.controllerProps as unknown,
            }
          }) as ProviderSetting[],
          models: await Promise.all(
            models.map(async (model) => {
              let capabilities: string[] = []

              if ('capabilities' in model && Array.isArray(model.capabilities)) {
                capabilities = [...(model.capabilities as string[])]
              }
              if (!capabilities.includes(ModelCapabilities.TOOLS)) {
                try {
                  const toolSupported = await value.isToolSupported(model.id)
                  if (toolSupported) {
                    capabilities.push(ModelCapabilities.TOOLS)
                  }
                } catch (error) {
                  console.warn(
                    `Failed to check tool support for model ${model.id}:`,
                    error
                  )
                  // Continue without tool capabilities if check fails
                }
              }

              // Add embeddings capability for embedding models
              if (model.embedding && !capabilities.includes(ModelCapabilities.EMBEDDINGS)) {
                capabilities = [...capabilities, ModelCapabilities.EMBEDDINGS]
              }

              return {
                id: model.id,
                model: model.id,
                name: model.name,
                description: model.description,
                capabilities,
                embedding: model.embedding, // Preserve embedding flag for filtering in UI
                provider: providerName,
                settings: Object.values(modelSettings).reduce(
                  (acc, setting) => {
                    let value = setting.controller_props.value
                    if (setting.key === 'ctx_len') {
                      value = 16384 // Default context length for Llama.cpp models
                    }
                    acc[setting.key] = {
                      ...setting,
                      controller_props: {
                        ...setting.controller_props,
                        value: value,
                      },
                    }
                    return acc
                  },
                  {} as Record<string, ProviderSetting>
                ),
              } as Model
            })
          ),
        }
        runtimeProviders.push(provider)
      }

      return runtimeProviders.concat(builtinProviders as ModelProvider[])
    } catch (error: unknown) {
      console.error('Error getting providers in Tauri:', error)
      return []
    }
  }

  async fetchModelsFromProvider(provider: ModelProvider): Promise<string[]> {
    if (!provider.base_url) {
      throw new Error('Provider must have base_url configured')
    }

    // Normalise: strip trailing slash for consistent URL construction.
    const baseUrl = provider.base_url.replace(/\/+$/, '')
    const hasApiKey = Boolean(provider.api_key)

    // Build the primary URL and, when the base_url does not already contain a
    // /v1 path segment, a fallback URL to try automatically on 404. Most
    // OpenAI-compatible servers (vLLM, llama.cpp, Ollama, …) expose models at
    // /v1/models, but users commonly type the bare host without the prefix —
    // and some serve a bare /models. Trying /models first then /v1/models on a
    // 404 covers both shapes without breaking already-prefixed URLs (ATO-211).
    const primaryUrl = `${baseUrl}/models`
    const hasV1Segment = /\/v1(\/|$)/.test(baseUrl)
    const fallbackUrl = hasV1Segment ? null : `${baseUrl}/v1/models`

    // The Tauri HTTP plugin runs requests through the Rust IPC layer, which
    // means they DO NOT appear in the WebView Network tab. Surface them via
    // explicit console logs so the user can see something is happening.
    console.info(
      `[providers:${provider.provider}] GET ${primaryUrl} (api_key=${hasApiKey ? 'present' : 'missing'})${fallbackUrl ? ` (fallback: ${fallbackUrl})` : ''}`
    )

    // Build request headers once; shared across primary and fallback attempts.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Add Origin header for local providers to avoid CORS issues
    // Some local providers (like Ollama) require an Origin header
    if (
      provider.base_url.includes('localhost:') ||
      provider.base_url.includes('127.0.0.1:')
    ) {
      headers['Origin'] = 'tauri://localhost'
    }

    // Only add authentication headers if API key is provided
    if (provider.api_key) {
      headers['x-api-key'] = provider.api_key
      headers['Authorization'] = `Bearer ${provider.api_key}`
    }

    if (provider.custom_header) {
      provider.custom_header.forEach((header) => {
        headers[header.header] = header.value
      })
    }

    // Hard timeout: the Tauri HTTP plugin does not always honour
    // AbortSignal on macOS, so we race the request against a manual timer.
    // 30s accommodates slow providers (OpenRouter's /models has been
    // observed at 8-19s) while still bounding the UI spinner.
    const FETCH_MODELS_TIMEOUT_MS = 30000

    // Helper: fire a single GET request with timeout, return the Response.
    // Throws on network error or timeout — does NOT throw on non-2xx status.
    const fetchUrl = async (url: string): Promise<Response> => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)
      try {
        return (await Promise.race([
          fetchTauri(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Request to ${provider.provider} timed out after ${FETCH_MODELS_TIMEOUT_MS / 1000}s. ` +
                      `The server may be unreachable or too slow to respond.`
                  )
                ),
              FETCH_MODELS_TIMEOUT_MS
            )
          ),
        ])) as Response
      } finally {
        clearTimeout(timer)
      }
    }

    try {
      let response: Response
      let usedUrl = primaryUrl

      // ── Attempt 1: primary URL ──────────────────────────────────────────
      try {
        response = await fetchUrl(primaryUrl)
      } catch (netErr) {
        // Network-level error on primary (no route, connection refused, …).
        // A /v1 fallback will not help if the host itself is unreachable, so
        // surface a readable message immediately.
        const msg = netErr instanceof Error ? netErr.message : String(netErr)
        if (msg.startsWith('Request to ') && msg.includes('timed out')) {
          throw new Error(msg)
        }
        throw new Error(
          `Cannot connect to ${provider.provider} at ${baseUrl}. ` +
            `Please check that the service is running and the address is correct.`
        )
      }

      console.info(
        `[providers:${provider.provider}] ${response.status} ${response.statusText} (${usedUrl})`
      )

      // ── Attempt 2: /v1/models fallback on 404 ──────────────────────────
      // When the primary URL returns 404 and we have not already tried the
      // /v1 prefix, retry once. This transparently handles the common case
      // where the user typed http://host:8000 instead of http://host:8000/v1.
      if (response.status === 404 && fallbackUrl !== null) {
        console.info(
          `[providers:${provider.provider}] 404 on ${primaryUrl}, retrying with /v1 fallback: ${fallbackUrl}`
        )
        try {
          const fallbackResponse = await fetchUrl(fallbackUrl)
          console.info(
            `[providers:${provider.provider}] ${fallbackResponse.status} ${fallbackResponse.statusText} (${fallbackUrl})`
          )
          // Any response from the fallback (even 401/5xx) is more informative
          // than the original 404, so adopt it.
          response = fallbackResponse
          usedUrl = fallbackUrl
        } catch {
          // Fallback network error — keep the original 404 response so the
          // status handling below can produce a coherent message.
        }
      }

      // ── Status-code error handling ──────────────────────────────────────
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            `Authentication failed: API key is required or invalid for ${provider.provider}`
          )
        } else if (response.status === 403) {
          throw new Error(
            `Access forbidden: Check your API key permissions for ${provider.provider}`
          )
        } else if (response.status === 404) {
          // Both primary and fallback (if attempted) returned 404.
          const triedList =
            fallbackUrl !== null
              ? `${primaryUrl} and ${fallbackUrl}`
              : primaryUrl
          throw new Error(
            `Models endpoint not found for ${provider.provider}. ` +
              `Tried: ${triedList}. ` +
              `If your server uses a sub-path, add /v1 to the base URL ` +
              `(e.g. http://host:8000/v1).`
          )
        } else {
          throw new Error(
            `Failed to fetch models from ${provider.provider}: ${response.status} ${response.statusText}`
          )
        }
      }

      // The Tauri HTTP plugin has been observed to hang on `response.json()`
      // for some providers. Read raw text under a timeout, parse synchronously.
      const BODY_READ_TIMEOUT_MS = 15000
      const rawText = await Promise.race([
        response.text(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Reading response body from ${provider.provider} timed out after ${BODY_READ_TIMEOUT_MS / 1000}s`
                )
              ),
            BODY_READ_TIMEOUT_MS
          )
        ),
      ])
      console.info(
        `[providers:${provider.provider}] body received (${rawText.length} bytes, url=${usedUrl})`
      )

      let data: unknown
      try {
        data = JSON.parse(rawText) as unknown
      } catch (err) {
        throw new Error(
          `Failed to parse JSON response from ${provider.provider}: ${err instanceof Error ? err.message : String(err)}`
        )
      }

      // Handle different response formats that providers might use.
      const obj =
        data && typeof data === 'object'
          ? (data as Record<string, unknown>)
          : null

      const collected: string[] = (() => {
        if (obj && Array.isArray(obj.data)) {
          // OpenAI format: { data: [{ id: "model-id" }, ...] }
          return (obj.data as Array<{ id?: string }>)
            .map((model) => model?.id ?? '')
            .filter(Boolean)
        }
        if (Array.isArray(data)) {
          // Direct array format: ["model-id1", "model-id2", ...]
          return (data as Array<unknown>)
            .map((model) =>
              typeof model === 'string'
                ? model
                : model && typeof model === 'object' && 'id' in model
                  ? String((model as { id?: unknown }).id ?? '')
                  : ''
            )
            .filter(Boolean)
        }
        if (obj && Array.isArray(obj.models)) {
          // Alternative format: { models: [...] }
          return (obj.models as Array<unknown>)
            .map((model) =>
              typeof model === 'string'
                ? model
                : model && typeof model === 'object' && 'id' in model
                  ? String((model as { id?: unknown }).id ?? '')
                  : ''
            )
            .filter(Boolean)
        }
        console.warn('Unexpected response format from provider API:', data)
        return []
      })()

      console.info(
        `[providers:${provider.provider}] parsed ${collected.length} model ids`
      )
      return collected
    } catch (error) {
      console.error('Error fetching models from provider:', error)

      // Preserve structured error messages thrown above — they are already
      // user-readable, so re-throw verbatim without wrapping.
      const structuredErrorPrefixes = [
        'Authentication failed',
        'Access forbidden',
        'Models endpoint not found',
        'Failed to fetch models from',
        'Cannot connect to ',
        'Request to ',
        'Reading response body',
        'Failed to parse JSON',
      ]

      if (
        error instanceof Error &&
        structuredErrorPrefixes.some((prefix) =>
          (error as Error).message.startsWith(prefix)
        )
      ) {
        throw new Error(error.message)
      }

      // Classify remaining network-level errors (e.g. from the Tauri IPC
      // layer) as connection failures.
      if (
        error instanceof Error &&
        (error.message.includes('fetch') ||
          error.name === 'AbortError' ||
          error.message.includes('network'))
      ) {
        throw new Error(
          `Cannot connect to ${provider.provider} at ${baseUrl}. ` +
            `Please check that the service is running and the address is correct.`
        )
      }

      // Generic fallback
      throw new Error(
        `Unexpected error while fetching models from ${provider.provider}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async updateSettings(
    providerName: string,
    settings: ProviderSetting[]
  ): Promise<void> {
    try {
      return ExtensionManager.getInstance()
        .getEngine(providerName)
        ?.updateSettings(
          settings.map((setting) => ({
            ...setting,
            controllerProps: {
              ...setting.controller_props,
              value:
                setting.controller_props.value !== undefined
                  ? setting.controller_props.value
                  : '',
            },
            controllerType: setting.controller_type,
          })) as SettingComponentProps[]
        )
    } catch (error) {
      console.error('Error updating settings in Tauri:', error)
      throw error
    }
  }
}
