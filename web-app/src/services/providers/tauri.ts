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

    const url = `${provider.base_url}/models`
    const hasApiKey = Boolean(provider.api_key)

    // The Tauri HTTP plugin runs requests through the Rust IPC layer, which
    // means they DO NOT appear in the WebView Network tab. Surface them via
    // explicit console logs so the user can see something is happening.
    console.info(
      `[providers:${provider.provider}] GET ${url} (api_key=${hasApiKey ? 'present' : 'missing'})`
    )

    try {
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
      if (hasApiKey) {
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
      // 12s is generous for a /models endpoint but bounded enough to not
      // leave the UI spinner running indefinitely.
      const FETCH_MODELS_TIMEOUT_MS = 12000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS)

      let response: Response
      try {
        response = (await Promise.race([
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
                    `Request to ${provider.provider} timed out after ${FETCH_MODELS_TIMEOUT_MS}ms`
                  )
                ),
              FETCH_MODELS_TIMEOUT_MS
            )
          ),
        ])) as Response
      } finally {
        clearTimeout(timer)
      }

      console.info(
        `[providers:${provider.provider}] response ${response.status} ${response.statusText}`
      )

      if (!response.ok) {
        // Provide more specific error messages based on status code (aligned with web implementation)
        if (response.status === 401) {
          throw new Error(
            `Authentication failed: API key is required or invalid for ${provider.provider}`
          )
        } else if (response.status === 403) {
          throw new Error(
            `Access forbidden: Check your API key permissions for ${provider.provider}`
          )
        } else if (response.status === 404) {
          throw new Error(
            `Models endpoint not found for ${provider.provider}. Check the base URL configuration.`
          )
        } else {
          throw new Error(
            `Failed to fetch models from ${provider.provider}: ${response.status} ${response.statusText}`
          )
        }
      }

      // The Tauri HTTP plugin has been observed to hang on `response.json()`
      // for some providers. Read raw text under a timeout, parse synchronously.
      const BODY_READ_TIMEOUT_MS = 8000
      const rawText = await Promise.race([
        response.text(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Reading response body from ${provider.provider} timed out after ${BODY_READ_TIMEOUT_MS}ms`
                )
              ),
            BODY_READ_TIMEOUT_MS
          )
        ),
      ])
      console.info(
        `[providers:${provider.provider}] body received (${rawText.length} bytes)`
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

      // Preserve structured error messages thrown above
      const structuredErrorPrefixes = [
        'Authentication failed',
        'Access forbidden',
        'Models endpoint not found',
        'Failed to fetch models from',
      ]

      if (
        error instanceof Error &&
        structuredErrorPrefixes.some((prefix) =>
          (error as Error).message.startsWith(prefix)
        )
      ) {
        throw new Error(error.message)
      }

      // Provide helpful error message for any connection errors
      if (error instanceof Error && error.message.includes('fetch')) {
        throw new Error(
          `Cannot connect to ${provider.provider} at ${provider.base_url}. Please check that the service is running and accessible.`
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
