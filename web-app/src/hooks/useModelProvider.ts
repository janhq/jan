import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { modelSettings } from '@/lib/predefined'

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
          const existingProviders = state.providers
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
              const mergedCapabilities = [
                ...(model.capabilities || []),
                ...(existingModel?.capabilities || []).filter(
                  (cap) => !(model.capabilities || []).includes(cap)
                ),
              ]
              return {
                ...model,
                settings: settings,
                capabilities: mergedCapabilities.length > 0 ? mergedCapabilities : undefined,
                displayName: existingModel?.displayName || model.displayName,
              }
            })

            return {
              ...provider,
              models: provider.persist ? updatedModels : mergedModels,
              settings: provider.settings.map((setting) => {
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
              }),
              api_key: existingProvider?.api_key || provider.api_key,
              base_url: existingProvider?.base_url || provider.base_url,
              active: existingProvider ? existingProvider?.active : true,
            }
          })
          return {
            providers: [
              ...updatedProviders,
              ...existingProviders.filter(
                (e) => !updatedProviders.some((p) => p.provider === e.provider)
              ),
            ],
          }
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
        return state
      },
      version: 10,
    }
  )
)
