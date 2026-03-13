import { EngineManager } from '@janhq/core'
import { getModelToStart } from './getModelToStart'
import { useModelProvider } from '@/hooks/useModelProvider'

/** Minimum context window size (tokens) enforced for local API server models. */
export const MIN_CONTEXT_SIZE = 32768

export type EnsureModelResult =
  | { status: 'already_loaded'; modelId: string; providerName: string }
  | { status: 'reloaded'; modelId: string; providerName: string }
  | { status: 'loaded'; modelId: string; providerName: string }
  | { status: 'no_model_available' }

export interface EnsureModelDeps {
  /** Models service — typically `serviceHub.models()` */
  modelsService: {
    getActiveModels(provider?: string): Promise<string[]>
    stopModel(model: string, provider?: string): Promise<unknown>
    startModel(
      provider: ModelProvider,
      model: string,
      bypassAutoUnload?: boolean
    ): Promise<unknown>
  }
  /** Override the model to load (e.g. user-configured default model). */
  modelOverride?: { model: string; provider: string } | null
  onLoadStart?: () => void
  onLoadEnd?: () => void
}

/** Read ctx_len from a model's settings in the provider store. */
function getModelCtxSize(modelId: string): number | undefined {
  const allProviders = useModelProvider.getState().providers
  for (const provider of allProviders) {
    if (!provider?.models) continue
    const model = provider.models.find(
      (m: { id: string }) => m.id === modelId
    )
    const ctxLen = model?.settings?.ctx_len?.controller_props?.value as
      | number
      | undefined
    if (ctxLen !== undefined) return ctxLen
  }
  return undefined
}

/** Find the provider that owns a given model ID. */
function findProviderForModel(modelId: string): ModelProvider | undefined {
  return useModelProvider
    .getState()
    .providers.find((p) =>
      p?.models?.some((m: { id: string }) => m.id === modelId)
    )
}

/** Persist the enforced ctx_len into the Zustand provider store so the UI reflects it. */
function updateProviderStoreCtxLen(
  providerName: string,
  modelId: string,
  ctxLen: number
): void {
  const { providers, updateProvider } = useModelProvider.getState()
  const provider = providers.find((p) => p.provider === providerName)
  if (!provider) return

  const updatedModels = provider.models.map((m) => {
    if (m.id !== modelId) return m
    return {
      ...m,
      settings: {
        ...m.settings,
        ctx_len: {
          ...(m.settings?.ctx_len ?? {}),
          controller_props: {
            ...(m.settings?.ctx_len?.controller_props ?? {}),
            value: ctxLen,
          },
        },
      },
    }
  }) as Model[]

  updateProvider(providerName, { models: updatedModels })
}

/** Clone a provider, overriding the target model's ctx_len. */
function createProviderWithEnforcedCtx(
  provider: ModelProvider,
  modelId: string,
  minCtxSize: number
): ModelProvider {
  return {
    ...provider,
    models: provider.models.map((m: { id: string; settings?: Record<string, unknown> }) => {
      if (m.id === modelId) {
        return {
          ...m,
          settings: {
            ...m.settings,
            ctx_len: {
              ...(m.settings?.ctx_len as object | undefined),
              controller_props: {
                ...((
                  m.settings?.ctx_len as {
                    controller_props?: object
                  }
                )?.controller_props ?? {}),
                value: minCtxSize,
              },
            },
          },
        }
      }
      return m
    }) as Model[],
  }
}

/**
 * Ensure a model is loaded with at least {@link MIN_CONTEXT_SIZE} context.
 *
 * - If a model is already loaded with sufficient context, returns immediately.
 * - If loaded with insufficient context, stops and reloads it.
 * - If no model is loaded, picks one via {@link getModelToStart} and loads it.
 */
export async function ensureModelForServer(
  deps: EnsureModelDeps
): Promise<EnsureModelResult> {
  const { modelsService, modelOverride, onLoadStart, onLoadEnd } = deps

  const loadedModels = await modelsService.getActiveModels()

  if (loadedModels && loadedModels.length > 0) {
    // When a default model is configured, stop ALL loaded models then restart:
    // 1) the default model (with enforced ctx), 2) any other models that were running
    if (modelOverride) {
      const overrideProvider = findProviderForModel(modelOverride.model)
      if (overrideProvider) {
        const otherModels = loadedModels.filter((id) => id !== modelOverride.model)

        onLoadStart?.()
        try {
          // Stop everything currently loaded
          await Promise.allSettled(
            loadedModels.map((id) =>
              modelsService.stopModel(id, findProviderForModel(id)?.provider)
            )
          )

          // Start the default model with enforced ctx_len
          const ctxSize = getModelCtxSize(modelOverride.model)
          const finalProvider =
            ctxSize === undefined || ctxSize < MIN_CONTEXT_SIZE
              ? createProviderWithEnforcedCtx(overrideProvider, modelOverride.model, MIN_CONTEXT_SIZE)
              : overrideProvider
          await modelsService.startModel(finalProvider, modelOverride.model, true)
          if (ctxSize === undefined || ctxSize < MIN_CONTEXT_SIZE) {
            updateProviderStoreCtxLen(overrideProvider.provider, modelOverride.model, MIN_CONTEXT_SIZE)
          }

          // Restart any other models that were loaded alongside the default
          await Promise.allSettled(
            otherModels.map(async (modelId) => {
              const provider = findProviderForModel(modelId)
              if (!provider) return
              await modelsService.startModel(provider, modelId, true)
            })
          )
        } finally {
          onLoadEnd?.()
        }

        return { status: 'loaded', modelId: modelOverride.model, providerName: overrideProvider.provider }
      }
    }

    const modelId = loadedModels[0]
    const currentCtxSize = getModelCtxSize(modelId)
    const providerName = findProviderForModel(modelId)?.provider ?? 'llamacpp'

    if (currentCtxSize !== undefined && currentCtxSize >= MIN_CONTEXT_SIZE) {
      return { status: 'already_loaded', modelId, providerName }
    }

    // Context too small or unknown — stop and reload with minimum
    const modelProvider = findProviderForModel(modelId)
    if (modelProvider) {
      onLoadStart?.()
      try {
        await modelsService.stopModel(modelId, modelProvider.provider)
        const engine = EngineManager.instance().get(modelProvider.provider)
        if (engine) {
          await engine.load(modelId, { ctx_size: MIN_CONTEXT_SIZE }, false, true)
        }
      } finally {
        onLoadEnd?.()
      }
      updateProviderStoreCtxLen(modelProvider.provider, modelId, MIN_CONTEXT_SIZE)
    }

    return { status: 'reloaded', modelId, providerName }
  }

  // No model loaded — pick one (prefer user-configured default, then auto-pick)
  const { selectedModel, selectedProvider, getProviderByName } =
    useModelProvider.getState()

  let modelToStart: { model: string; provider: ModelProvider } | null = null

  if (modelOverride) {
    const provider = getProviderByName(modelOverride.provider)
    if (provider && provider.models.some((m) => m.id === modelOverride.model)) {
      modelToStart = { model: modelOverride.model, provider }
    }
  }

  if (!modelToStart) {
    modelToStart = getModelToStart({
      selectedModel,
      selectedProvider,
      getProviderByName,
    })
  }

  if (!modelToStart) {
    return { status: 'no_model_available' }
  }

  // Enforce minimum context — undefined means engine would use its own small default
  const currentCtxSize = getModelCtxSize(modelToStart.model)
  let finalProvider = modelToStart.provider

  if (currentCtxSize === undefined || currentCtxSize < MIN_CONTEXT_SIZE) {
    finalProvider = createProviderWithEnforcedCtx(
      modelToStart.provider,
      modelToStart.model,
      MIN_CONTEXT_SIZE
    )
  }

  onLoadStart?.()
  try {
    await modelsService.startModel(finalProvider, modelToStart.model, true)
    await new Promise((resolve) => setTimeout(resolve, 500))
  } finally {
    onLoadEnd?.()
  }

  if (currentCtxSize === undefined || currentCtxSize < MIN_CONTEXT_SIZE) {
    updateProviderStoreCtxLen(modelToStart.provider.provider, modelToStart.model, MIN_CONTEXT_SIZE)
  }

  return {
    status: 'loaded',
    modelId: modelToStart.model,
    providerName: modelToStart.provider.provider,
  }
}
