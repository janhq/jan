import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { modelSettings } from '@/lib/predefined'
import { LOCAL_LLAMACPP_PROVIDER } from '@/lib/utils'

/**
 * Provider id that the Windows build *removed* (the turboquant `llamacpp`
 * extension is excluded from the Windows installer per ADR 2026-05-22).
 * Used here only for the one-time migration / runtime alias logic; outside
 * Windows, both ids continue to coexist and this constant is harmless.
 */
const LEGACY_LLAMACPP_PROVIDER = 'llamacpp'

/**
 * Returns the canonical local llama.cpp provider id for THIS platform.
 * On Windows this collapses both `'llamacpp'` and `'llamacpp-upstream'`
 * to `'llamacpp-upstream'`; on macOS/Linux it returns the input
 * unchanged. Keeps call sites that took `'llamacpp'` from persisted
 * state, thread history, `lastUsedModel`, etc. transparently working
 * after the upstream-only consolidation.
 */
const aliasLocalLlamacppProvider = (providerName: string): string =>
  IS_WINDOWS && providerName === LEGACY_LLAMACPP_PROVIDER
    ? LOCAL_LLAMACPP_PROVIDER
    : providerName

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
      // Windows ships only `llamacpp-upstream`; macOS/Linux keep the
      // turboquant `llamacpp` provider as the default. The migration
      // below also rewrites this field if a pre-update install had
      // `'llamacpp'` persisted as the active provider.
      selectedProvider: LOCAL_LLAMACPP_PROVIDER,
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
          // On Windows the turboquant `llamacpp` provider was excised from
          // the build (ADR 2026-05-22). The zustand `migrate` block below
          // purges any persisted instance once, but `setProviders` is also
          // called every time the engine list is refreshed — so guard the
          // merge path here too, otherwise a single stale entry in
          // localStorage would resurrect the "Atomic Llama.cpp Turboquant"
          // row in Settings → Model Providers every time the user
          // navigated there.
          const incoming = IS_WINDOWS
            ? providers.filter((p) => p.provider !== LEGACY_LLAMACPP_PROVIDER)
            : providers
          const existingProviders = state.providers
            // Filter out legacy llama.cpp provider for migration
            // Can remove after a couple of releases
            .filter((e) => e.provider !== 'llama.cpp')
            // Filter out the (now Windows-excluded) turboquant provider —
            // see the comment on `incoming` above. No-op on macOS/Linux.
            .filter(
              (e) => !IS_WINDOWS || e.provider !== LEGACY_LLAMACPP_PROVIDER
            )
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

          const updatedProviders = incoming.map((provider) => {
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
              const persistedModels =
                legacyModels && legacyModels.length > 0 ? legacyModels : models
              const persistedModel =
                persistedModels.find((m) => m.id === model.id) ??
                persistedModels.find(
                  (m) =>
                    m.id
                      .split(':')
                      .slice(0, 2)
                      .join(getServiceHub().path().sep()) === model.id
                )
              const settings = persistedModel?.settings || model.settings
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
                capabilities:
                  mergedCapabilities.length > 0
                    ? mergedCapabilities
                    : undefined,
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
          const nextProviders = [
            ...updatedProviders,
            ...existingProviders.filter(
              (e) => !updatedProviders.some((p) => p.provider === e.provider)
            ),
          ]

          const nextSelectedProvider = nextProviders.find(
            (provider) => provider.provider === state.selectedProvider
          )
          const nextSelectedModel = state.selectedModel?.id
            ? (nextSelectedProvider?.models.find(
                (model) => model.id === state.selectedModel?.id
              ) ?? null)
            : null

          return {
            providers: nextProviders,
            selectedModel: nextSelectedModel,
          }
        }),
      updateProvider: (providerName, data) => {
        set((state) => {
          let nextSelectedModel = state.selectedModel

          const nextProviders = state.providers.map((provider) => {
            if (provider.provider !== providerName) {
              return provider
            }

            const updatedProvider = {
              ...provider,
              ...data,
            }

            if (
              state.selectedProvider === providerName &&
              state.selectedModel?.id
            ) {
              nextSelectedModel =
                updatedProvider.models.find(
                  (model) => model.id === state.selectedModel?.id
                ) ?? null
            }

            return updatedProvider
          })

          return {
            providers: nextProviders,
            selectedModel: nextSelectedModel,
          }
        })
      },
      getProviderByName: (providerName: string) => {
        // Windows-only alias: any legacy `'llamacpp'` lookup transparently
        // resolves to `'llamacpp-upstream'`. Covers leftover references in
        // thread history, lastUsedModel, route params, etc. that escaped
        // the one-time migration.
        const resolvedName = aliasLocalLlamacppProvider(providerName)
        const provider = get().providers.find(
          (provider) => provider.provider === resolvedName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        const resolvedName = aliasLocalLlamacppProvider(providerName)
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === resolvedName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Persist the *resolved* provider id so subsequent reads (e.g.
        // `selectedProvider` rendering, model lookups) see the canonical
        // local llama.cpp provider for this OS, not the legacy alias.
        set({
          selectedProvider: resolvedName,
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

        if (version <= 10 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.auto_increase_ctx_len) {
                  model.settings.auto_increase_ctx_len = {
                    ...modelSettings.auto_increase_ctx_len,
                    controller_props: {
                      ...modelSettings.auto_increase_ctx_len.controller_props,
                    },
                  }
                }
              })
            }
          })
        }
        if (version <= 11 && state?.providers) {
          state.providers.forEach((provider) => {
            if (
              provider.models &&
              (provider.provider === 'llamacpp' || provider.provider === 'mlx')
            ) {
              provider.models.forEach((model) => {
                if (model.settings?.ctx_len?.controller_props) {
                  const current = model.settings.ctx_len.controller_props.value
                  if (current === 8192 || current === '8192') {
                    model.settings.ctx_len.controller_props.value = 16384
                  }
                  if (
                    model.settings.ctx_len.controller_props.placeholder ===
                    '8192'
                  ) {
                    model.settings.ctx_len.controller_props.placeholder =
                      '16384'
                  }
                }
              })
            }
          })
        }

        // v13 — Windows-only: the upstream-only consolidation
        // (ADR 2026-05-22) removed the turboquant `llamacpp` provider
        // from the Windows build. Existing installs upgrading into this
        // version still have a `llamacpp` ModelProvider object in
        // zustand-persisted state — drop it, and redirect any active
        // selection to `'llamacpp-upstream'` so the model picker / Settings
        // → Providers page render cleanly on first launch after the
        // update. Models on disk (under `<data>/llamacpp/models/`) are
        // shared between both providers via `MODELS_PROVIDER_ROOT =
        // 'llamacpp'` in the upstream extension, so no model-level data
        // migration is necessary.
        if (version <= 12 && state?.providers && IS_WINDOWS) {
          state.providers = state.providers.filter(
            (provider) => provider.provider !== LEGACY_LLAMACPP_PROVIDER
          )
          if (state.selectedProvider === LEGACY_LLAMACPP_PROVIDER) {
            state.selectedProvider = LOCAL_LLAMACPP_PROVIDER
            // INTENTIONALLY do NOT null `selectedModel` here. The on-disk
            // GGUFs are shared between providers (both extensions point at
            // `<data>/llamacpp/models/`), so the upstream extension will
            // re-register the same model id at `setProviders` time. The
            // re-resolve block at the bottom of `setProviders`
            // (`nextSelectedModel = nextSelectedProvider?.models.find(...)`)
            // then rebinds `selectedModel` to the upstream provider's copy
            // of the same model on first paint — without that, the user
            // would have to manually re-pick the active model in the
            // dropdown after every update, even though the same model is
            // still on disk.
          }
        }

        // v14 — macOS: ATO-116 made `llamacpp-upstream` the default local
        // engine, but the v13 redirect above is IS_WINDOWS-gated, so macOS
        // users carrying a pre-ATO-116 `selectedProvider: 'llamacpp'` (the
        // turboquant fork, which crashes on new archs like gemma4uv /
        // lfm2moe) were never moved off it — auto-start and the model-bar
        // default kept loading GGUFs on turboquant (ATO-136). Redirect ONLY
        // the global default selection to the upstream provider. We
        // deliberately:
        //   - do NOT remove the turboquant `llamacpp` provider (still shipped
        //     on macOS as an explicit manual choice), and
        //   - do NOT touch per-thread bindings (left to their own history),
        // so this reverses only the *default* clause of the IS_WINDOWS gate.
        // The on-disk GGUF tree is shared (MODELS_PROVIDER_ROOT='llamacpp'),
        // so `setProviders` re-resolves `selectedModel` against the upstream
        // provider's copy of the same model (see the v13 note above).
        if (
          version <= 13 &&
          IS_MACOS &&
          state?.selectedProvider === LEGACY_LLAMACPP_PROVIDER
        ) {
          state.selectedProvider = LOCAL_LLAMACPP_PROVIDER
        }

        return state
      },
      version: 14,
    }
  )
)
