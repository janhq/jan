import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { modelSettings } from '@/lib/predefined'
import { predefinedProviders } from '@/constants/providers'
import {
  API_KEY_FALLBACKS_SETTING_KEY,
  parseApiKeyFallbacks,
  serializeApiKeyFallbacks,
} from '@/lib/provider-api-keys'

const API_KEY_FALLBACKS_MIGRATION_FLAG = 'api_key_fallbacks_migrated_to_settings'

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  deletedModels: string[]
  getModelBy: (modelId: string) => Model | undefined
  setProviders: (providers: ModelProvider[]) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  addProvider: (provider: ModelProvider) => void
  deleteProvider: (providerName: string) => void
  deleteModel: (modelId: string) => void
  addDeletedModels: (modelIds: string[]) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      deletedModels: [],
      getModelBy: (modelId: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === modelId)
      },
      setProviders: (providers) =>
        set((state) => {
          // MLX is Apple-Silicon only; drop it on every other platform so it
          // can't be reactivated, queried, or shown anywhere in the UI.
          providers = IS_MACOS
            ? providers
            : providers.filter((e) => e.provider !== 'mlx')
          const existingProviders = state.providers
            .filter((e) => IS_MACOS || e.provider !== 'mlx')
            // Filter out legacy llama.cpp provider for migration
            // Can remove after a couple of releases
            .filter((e) => e.provider !== 'llama.cpp')
            .map((provider) => {
              return {
                ...provider,
                models: provider.models.filter(
                  (e) =>
                    ('id' in e || 'model' in e) &&
                    typeof (e.id ?? e.model) === 'string'
                ),
              }
            })

          let legacyModels: Model[] | undefined = []
          /// Cortex Migration
          if (
            localStorage.getItem('cortex_model_settings_migrated') !== 'true'
          ) {
            legacyModels = state.providers.find(
              (e) => e.provider === 'llama.cpp'
            )?.models
            localStorage.setItem('cortex_model_settings_migrated', 'true')
          }
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          const updatedProviders = providers.map((provider) => {
            const existingProvider = existingProviders.find(
              (x) => x.provider === provider.provider
            )
            const models = (existingProvider?.models || []).filter(
              (e) =>
                ('id' in e || 'model' in e) &&
                typeof (e.id ?? e.model) === 'string'
            )
            const mergedModels = [
              ...(provider?.models ?? []).filter(
                (e) =>
                  ('id' in e || 'model' in e) &&
                  typeof (e.id ?? e.model) === 'string' &&
                  !models.some((m) => m.id === e.id) &&
                  !currentDeletedModels.includes(e.id)
              ),
              ...models,
            ]
            const updatedModels = provider.models?.map((model) => {
              const settings =
                (legacyModels && legacyModels?.length > 0
                  ? legacyModels
                  : models
                ).find(
                  (m) =>
                    m.id
                      .split(':')
                      .slice(0, 2)
                      .join(getServiceHub().path().sep()) === model.id
                )?.settings || model.settings
              const existingModel = models.find((m) => m.id === model.id)
              const userConfiguredCapabilities =
                (
                  existingModel as Model & {
                    _userConfiguredCapabilities?: boolean
                  }
                )?._userConfiguredCapabilities === true

              const engineOwnedCaps = new Set(['vision', 'audio', 'embeddings'])
              const engineCaps = model.capabilities || []
              const existingCaps = existingModel?.capabilities || []
              const mergedCapabilities = userConfiguredCapabilities
                ? [
                    ...existingCaps.filter((c) => !engineOwnedCaps.has(c)),
                    ...engineCaps.filter((c) => engineOwnedCaps.has(c)),
                  ]
                : [
                    ...engineCaps,
                    ...existingCaps.filter((c) => !engineCaps.includes(c)),
                  ]
              return {
                ...model,
                settings: settings,
                capabilities:
                  mergedCapabilities.length > 0 ? mergedCapabilities : undefined,
                displayName: existingModel?.displayName || model.displayName,
                ...(userConfiguredCapabilities
                  ? { _userConfiguredCapabilities: true as const }
                  : {}),
              }
            })

            const mergedSettings = provider.settings.map((setting) => {
              const existingSetting = provider.persist
                ? undefined
                : existingProvider?.settings?.find(
                    (x) => x.key === setting.key
                  )
              return {
                ...setting,
                controller_props: {
                  ...setting.controller_props,
                  ...(existingSetting?.controller_props || {}),
                },
              }
            })

            // Preserve a zustand-only api-key-fallbacks setting when the
            // backend doesn't return it, so disk-persisted fallbacks survive
            // localStorage clears once they round-trip through updateSettings.
            if (
              !provider.persist &&
              !mergedSettings.some((s) => s.key === API_KEY_FALLBACKS_SETTING_KEY)
            ) {
              const existingFallbacksSetting = existingProvider?.settings?.find(
                (s) => s.key === API_KEY_FALLBACKS_SETTING_KEY
              )
              if (existingFallbacksSetting) {
                mergedSettings.push(existingFallbacksSetting)
              }
            }

            const fallbacksSetting = mergedSettings.find(
              (s) => s.key === API_KEY_FALLBACKS_SETTING_KEY
            )
            const fallbacksFromSetting = fallbacksSetting
              ? parseApiKeyFallbacks(
                  (
                    fallbacksSetting.controller_props as {
                      value?: unknown
                    }
                  )?.value
                )
              : undefined

            return {
              ...provider,
              models: provider.persist ? updatedModels : mergedModels,
              settings: mergedSettings,
              api_key: existingProvider?.api_key || provider.api_key,
              api_key_fallbacks:
                existingProvider?.api_key_fallbacks ??
                fallbacksFromSetting ??
                provider.api_key_fallbacks,
              base_url: existingProvider?.base_url || provider.base_url,
              active: existingProvider ? existingProvider?.active : true,
            }
          })
          const nextProviders = [
            ...updatedProviders,
            ...existingProviders.filter(
              (e) => !updatedProviders.some((p) => p.provider === e.provider)
            ),
          ]

          // One-shot migration: persist zustand-only fallback keys to disk
          // via the providers extension so they survive localStorage clears.
          if (
            typeof localStorage !== 'undefined' &&
            localStorage.getItem(API_KEY_FALLBACKS_MIGRATION_FLAG) !== 'true'
          ) {
            const toMigrate = nextProviders.filter((p) => {
              const fallbacks = p.api_key_fallbacks ?? []
              if (fallbacks.length === 0) return false
              const setting = p.settings?.find(
                (s) => s.key === API_KEY_FALLBACKS_SETTING_KEY
              )
              const persistedValue = setting
                ? (setting.controller_props as { value?: unknown })?.value
                : undefined
              return (
                typeof persistedValue !== 'string' || persistedValue.length === 0
              )
            })
            localStorage.setItem(API_KEY_FALLBACKS_MIGRATION_FLAG, 'true')
            if (toMigrate.length > 0) {
              queueMicrotask(() => {
                const svc = getServiceHub().providers()
                for (const p of toMigrate) {
                  const value = serializeApiKeyFallbacks(p.api_key_fallbacks ?? [])
                  const settings = [...(p.settings ?? [])]
                  const idx = settings.findIndex(
                    (s) => s.key === API_KEY_FALLBACKS_SETTING_KEY
                  )
                  if (idx !== -1) {
                    const props = settings[idx].controller_props as {
                      value: string | boolean | number
                    }
                    props.value = value
                  } else {
                    settings.push({
                      key: API_KEY_FALLBACKS_SETTING_KEY,
                      title: 'API Key Fallbacks',
                      description: '',
                      controller_type: 'input',
                      controller_props: {
                        value,
                        type: 'password',
                        placeholder: '',
                      },
                    } as (typeof settings)[number])
                  }
                  svc.updateSettings(p.provider, settings).catch((err) => {
                    console.warn(
                      `[api-key-fallbacks] migration failed for ${p.provider}:`,
                      err
                    )
                  })
                }
              })
            }
          }

          return { providers: nextProviders }
        }),
      updateProvider: (providerName, data) => {
        set((state) => ({
          providers: state.providers.map((provider) => {
            if (provider.provider === providerName) {
              return {
                ...provider,
                ...data,
              }
            }
            return provider
          }),
        }))
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Update state with provider name and model object
        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        set((state) => {
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          return {
            providers: state.providers.map((provider) => {
              const models = provider.models.filter(
                (model) => model.id !== modelId
              )
              return {
                ...provider,
                models,
              }
            }),
            deletedModels: [...currentDeletedModels, modelId],
          }
        })
      },
      addDeletedModels: (modelIds: string[]) => {
        if (modelIds.length === 0) return
        set((state) => {
          const current = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []
          const next = new Set(current)
          modelIds.forEach((id) => next.add(id))
          if (next.size === current.length) return state
          return { deletedModels: Array.from(next) }
        })
      },
      addProvider: (provider: ModelProvider) => {
        set((state) => ({
          providers: [...state.providers, provider],
        }))
      },
      deleteProvider: (providerName: string) => {
        set((state) => ({
          providers: state.providers.filter(
            (provider) => provider.provider !== providerName
          ),
        }))
      },
    }),
    {
      name: localStorageKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as ModelProviderState & {
          providers: Array<
            ModelProvider & {
              models: Array<
                Model & {
                  settings?: Record<string, unknown> & {
                    chatTemplate?: string
                    chat_template?: string
                  }
                }
              >
            }
          >
        }

        if (version <= 1 && state?.providers) {
          state.providers.forEach((provider) => {
            // Update cont_batching description for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const contBatchingSetting = provider.settings.find(
                (s) => s.key === 'cont_batching'
              )
              if (contBatchingSetting) {
                contBatchingSetting.description =
                  'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
              }
            }

            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                // Migrate chatTemplate key to chat_template
                if (model.settings.chatTemplate) {
                  model.settings.chat_template = model.settings.chatTemplate
                  delete model.settings.chatTemplate
                }

                // Add missing settings with defaults
                if (!model.settings.chat_template) {
                  model.settings.chat_template = {
                    ...modelSettings.chatTemplate,
                    controller_props: {
                      ...modelSettings.chatTemplate.controller_props,
                    },
                  }
                }

                if (!model.settings.override_tensor_buffer_t) {
                  model.settings.override_tensor_buffer_t = {
                    ...modelSettings.override_tensor_buffer_t,
                    controller_props: {
                      ...modelSettings.override_tensor_buffer_t
                        .controller_props,
                    },
                  }
                }

                if (!model.settings.no_kv_offload) {
                  model.settings.no_kv_offload = {
                    ...modelSettings.no_kv_offload,
                    controller_props: {
                      ...modelSettings.no_kv_offload.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 2 && state?.providers) {
          state.providers.forEach((provider) => {
            // Update cont_batching description for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const contBatchingSetting = provider.settings.find(
                (s) => s.key === 'cont_batching'
              )
              if (contBatchingSetting) {
                contBatchingSetting.description =
                  'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
              }
            }

            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.batch_size) {
                  model.settings.batch_size = {
                    ...modelSettings.batch_size,
                    controller_props: {
                      ...modelSettings.batch_size.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 3 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Anthropic provider base URL and add custom headers
            if (provider.provider === 'anthropic') {
              if (provider.base_url === 'https://api.anthropic.com') {
                provider.base_url = 'https://api.anthropic.com/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.anthropic.com/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.anthropic.com/v1'
                }
              }

              if (!provider.custom_header) {
                provider.custom_header = [
                  {
                    header: 'anthropic-version',
                    value: '2023-06-01',
                  },
                  {
                    header: 'anthropic-dangerous-direct-browser-access',
                    value: 'true',
                  },
                ]
              }
            }

            if (provider.provider === 'cohere') {
              if (
                provider.base_url === 'https://api.cohere.ai/compatibility/v1'
              ) {
                provider.base_url = 'https://api.cohere.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.cohere.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.cohere.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 4 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.cpu_moe) {
                  model.settings.cpu_moe = {
                    ...modelSettings.cpu_moe,
                    controller_props: {
                      ...modelSettings.cpu_moe.controller_props,
                    },
                  }
                }

                if (!model.settings.n_cpu_moe) {
                  model.settings.n_cpu_moe = {
                    ...modelSettings.n_cpu_moe,
                    controller_props: {
                      ...modelSettings.n_cpu_moe.controller_props,
                    },
                  }
                }
              })
            }
          })
        }
        if (version <= 5 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate flash_attn setting to dropdown for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const flashAttentionSetting = provider.settings.find(
                (s) => s.key === 'flash_attn'
              )
              if (flashAttentionSetting) {
                flashAttentionSetting.controller_type = 'dropdown'
                flashAttentionSetting.controller_props = {
                  ...flashAttentionSetting.controller_props,
                  options: [
                    { name: 'Auto', value: 'auto' },
                    { name: 'On', value: 'on' },
                    { name: 'Off', value: 'off' },
                  ],
                  value: 'auto',
                }
              }
            }
          })
        }
        if (version <= 7 && state?.providers) {
          // Remove 'proactive' capability from all models as it's now managed in MCP settings
          state.providers.forEach((provider) => {
            if (provider.models) {
              provider.models.forEach((model) => {
                if (model.capabilities) {
                  model.capabilities = model.capabilities.filter(
                    (cap) => cap !== 'proactive'
                  )
                }
              })
            }
          })
        }
        if (version <= 8 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Mistral provider base URL to add /v1
            if (provider.provider === 'mistral') {
              if (provider.base_url === 'https://api.mistral.ai') {
                provider.base_url = 'https://api.mistral.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.mistral.ai'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.mistral.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.mistral.ai'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.mistral.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 9 && state?.providers) {
          state.providers = state.providers.filter(
            (provider) => provider.provider !== 'cohere'
          )
        }

        // Migration v10 historically inserted `auto_increase_ctx_len`. The
        // setting was removed in v15, so v10 is now a no-op for any user
        // still passing through this point.

        if (version <= 11 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp') return

            // Reasoning moved from extension-level to per-model settings —
            // strip any stale entry from the provider settings panel.
            if (provider.settings) {
              provider.settings = provider.settings.filter(
                (s) => s.key !== 'reasoning'
              )
            }

            if (provider.models) {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.reasoning) {
                  model.settings.reasoning = {
                    ...modelSettings.reasoning,
                    controller_props: {
                      ...modelSettings.reasoning.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 13 && state?.providers) {
          // Predefined providers no longer carry a user-editable base-url
          // setting. Force their base_url back to the canonical constant and
          // strip any leftover base-url entry from persisted settings[].
          const canonicalByName = new Map(
            predefinedProviders.map((p) => [p.provider, p.base_url])
          )
          state.providers.forEach((provider) => {
            const canonical = canonicalByName.get(provider.provider)
            if (!canonical) return
            provider.base_url = canonical
            if (provider.settings) {
              provider.settings = provider.settings.filter(
                (s) => s.key !== 'base-url'
              )
            }
          })
        }

        if (version <= 12 && state?.providers) {
          // Reset ctx_len from the prior 8192 default to '' so llama.cpp picks
          // (auto-fit when enabled, model default otherwise). Preserve any
          // user-customised value.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              const ctx = model.settings?.ctx_len as
                | { controller_props?: { value?: unknown } }
                | undefined
              if (ctx?.controller_props?.value === 8192) {
                ctx.controller_props.value = ''
              }
            })
          })
        }

        if (version <= 13 && state?.providers) {
          // `defrag-thold` was deprecated upstream and the control was deleted
          // from settings.json. Strip the orphan entry from the persisted
          // provider settings array so localStorage doesn't carry it forever.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.settings) return
            provider.settings = provider.settings.filter(
              (s) => s.key !== 'defrag_thold'
            )
          })
        }

        if (version <= 14 && state?.providers) {
          // Auto-increase context was removed — the manual "Increase Context
          // Size" button in the error banner now owns this. Strip the per-model
          // setting entry from llamacpp models so the sidebar doesn't render a
          // dead control.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              if (model.settings?.auto_increase_ctx_len) {
                delete (model.settings as Record<string, unknown>)
                  .auto_increase_ctx_len
              }
            })
          })
        }
        return state
      },
      version: 15,
    }
  )
)
