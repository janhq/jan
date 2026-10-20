import { useModelProvider } from '@/hooks/useModelProvider'
import { useCoworkSessions } from '@/hooks/useCoworkSessions'
import { useCoworkRun } from '@/hooks/useCoworkRun'
import type { ModelsService } from '@/services/models/types'

export function coworkLocalModel(
  provider: ModelProvider | undefined,
  modelId: string | undefined
): Model | undefined {
  if (
    !provider ||
    provider.active === false ||
    (provider.provider !== 'llamacpp' && provider.provider !== 'mlx')
  )
    return undefined
  return provider.models.find((model) => model.id === modelId)
}

export function coworkModelContext(
  provider: ModelProvider | undefined,
  modelId: string | undefined
): { value: number; max: number; next: number | undefined } | undefined {
  const setting = coworkLocalModel(provider, modelId)?.settings?.ctx_len
  if (!setting) return undefined
  const value = Number(setting.controller_props?.value)
  const max = Number(setting.controller_props?.max)
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    !Number.isInteger(max) ||
    max <= 0
  )
    return undefined
  return { value, max, next: nextCoworkContextSize(value, max) }
}

/** Compact context readout for chips/rail headers: 8192 -> "8K". */
export function formatContextSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1024) return String(value)
  return `${Math.round(value / 1024)}K`
}

export function nextCoworkContextSize(
  current: number,
  max: number
): number | undefined {
  const candidate =
    current < 8192 ? 8192 : current < 32768 ? 32768 : Math.round(current * 1.5)
  const next = Math.min(candidate, max)
  return next > current ? next : undefined
}

export async function increaseCoworkContext(
  models: ModelsService,
  providerName: string,
  modelId: string
): Promise<void> {
  const provider = useModelProvider.getState().getProviderByName(providerName)
  let context = coworkModelContext(provider, modelId)
  if (!context) {
    const setting = coworkLocalModel(provider, modelId)?.settings?.ctx_len
    const value = Number(setting?.controller_props?.value)
    if (setting && Number.isInteger(value) && value > 0) {
      const max = await models.getModelContextLimit(modelId, providerName)
      if (max !== undefined && Number.isInteger(max) && max > 0)
        context = { value, max, next: nextCoworkContextSize(value, max) }
    }
  }
  if (context?.next === undefined)
    throw new Error(
      'No supported context increase is available. Check the model context limit in provider settings.'
    )

  if (providerName === 'llamacpp') {
    await models.updateModelSettings(modelId, { ctx_len: context.next })
  } else if ((await models.getActiveModels(providerName)).includes(modelId)) {
    const result = await models.stopModel(modelId, providerName)
    if (!result?.success)
      throw new Error(
        result?.error ??
          'Could not unload the model. Stop its active requests and try again.'
      )
  }

  // Publish only after application succeeds. Merge into live state without
  // restoring an old provider snapshot or changing the user's selection.
  const state = useModelProvider.getState()
  const latest = state.getProviderByName(providerName)
  if (!latest) return
  state.updateProvider(providerName, {
    models: latest.models.map((model) =>
      model.id === modelId
        ? ({
            ...model,
            settings: {
              ...model.settings,
              ctx_len: {
                ...model.settings?.ctx_len,
                controller_props: {
                  ...model.settings?.ctx_len?.controller_props,
                  value: context.next,
                  max: context.max,
                },
              },
            },
          } as Model)
        : model
    ),
  })
}

export async function recoverCoworkContext(
  models: ModelsService,
  retry: () => void
): Promise<void> {
  const { currentId, sessions } = useCoworkSessions.getState()
  const session = sessions.find((item) => item.id === currentId)
  const { selectedProvider, selectedModel } = useModelProvider.getState()
  if (!session || !selectedModel || useCoworkRun.getState().runId[session.id])
    return

  await increaseCoworkContext(models, selectedProvider, selectedModel.id)

  const latestSession = useCoworkSessions.getState()
  const latestModel = useModelProvider.getState()
  if (
    latestSession.currentId !== session.id ||
    latestSession.sessions.find((item) => item.id === session.id)?.messages !==
      session.messages ||
    latestModel.selectedProvider !== selectedProvider ||
    latestModel.selectedModel?.id !== selectedModel.id ||
    useCoworkRun.getState().runId[session.id]
  )
    return

  // Resume committed history, including completed tool calls and their results.
  retry()
}
