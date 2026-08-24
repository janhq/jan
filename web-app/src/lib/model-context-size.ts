import { modelSettings } from '@/lib/predefined'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'

/** llama.cpp / MLX: ctx_len is an engine load parameter. */
export function isLocalEngineProvider(providerName: string): boolean {
  return providerName === 'llamacpp' || providerName === 'mlx'
}

export const REMOTE_CTX_LEN_DESCRIPTION =
  "Client-side context budget used for overflow detection. Does not change the remote model's window. Leave empty to disable the client cap."

export const REMOTE_CTX_LEN_MAX = 1_048_576
export const LOCAL_CTX_LEN_MAX = 131_072

export function parseCtxLen(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

export function getModelCtxLen(
  model: Model | null | undefined
): number | undefined {
  return parseCtxLen(model?.settings?.ctx_len?.controller_props?.value)
}

/**
 * Next context length after a manual "Increase Context Size" click.
 *
 * Local engines keep the historical 8k → 32k → ×1.5 ladder (VRAM-sensitive).
 * Remote/OpenAI-compatible providers jump more aggressively so a ~34k prompt
 * is not still blocked after the first click, and honor `minNeeded` when the
 * overflow error includes a token count.
 */
export function nextCtxLen(
  current: number,
  options: {
    max: number
    minNeeded?: number
    remote?: boolean
  }
): number {
  const { max, minNeeded, remote } = options
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0

  let next: number
  if (remote) {
    if (safeCurrent < 65536) next = 65536
    else if (safeCurrent < 131072) next = 131072
    else next = Math.round(safeCurrent * 1.5)
  } else if (safeCurrent < 8192) {
    next = 8192
  } else if (safeCurrent < 32768) {
    next = 32768
  } else {
    next = Math.round(safeCurrent * 1.5)
  }

  if (minNeeded != null && Number.isFinite(minNeeded) && minNeeded > 0) {
    // Overflow heuristic is tokens >= ctx * 0.9, so the new cap must exceed that.
    const required = Math.ceil(minNeeded / 0.9) + 1
    const rounded = Math.ceil(required / 1024) * 1024
    next = Math.max(next, rounded)
  }

  return Math.min(next, max)
}

export function ctxLenMax(
  model: Model | null | undefined,
  remote: boolean
): number {
  const configured = parseCtxLen(model?.settings?.ctx_len?.controller_props?.max)
  if (configured) return configured
  return remote ? REMOTE_CTX_LEN_MAX : LOCAL_CTX_LEN_MAX
}

export function createRemoteCtxLenSetting(
  value: number | string = ''
): ProviderSetting {
  return {
    ...modelSettings.ctx_len,
    description: REMOTE_CTX_LEN_DESCRIPTION,
    controller_props: {
      ...modelSettings.ctx_len.controller_props,
      value,
      placeholder: '131072',
      max: REMOTE_CTX_LEN_MAX,
    },
  }
}

export function withRemoteCtxLen<T extends { settings?: Model['settings'] }>(
  model: T
): T {
  if (model.settings?.ctx_len) return model
  return {
    ...model,
    settings: {
      ...model.settings,
      ctx_len: createRemoteCtxLenSetting(''),
    },
  }
}

export function seedRemoteModelsCtxLen<T extends { settings?: Model['settings'] }>(
  models: T[] | undefined
): T[] | undefined {
  if (!models) return models
  return models.map((model) => withRemoteCtxLen(model))
}

export function applyCtxLenToModel(
  model: Model,
  newValue: number,
  remote: boolean
): Model {
  const existing = model.settings?.ctx_len
  const base = remote
    ? createRemoteCtxLenSetting(newValue)
    : {
        ...modelSettings.ctx_len,
        ...(existing ?? {}),
        controller_props: {
          ...modelSettings.ctx_len.controller_props,
          ...(existing?.controller_props ?? {}),
          value: newValue,
        },
      }
  return {
    ...model,
    settings: {
      ...model.settings,
      ctx_len: remote
        ? {
            ...base,
            ...(existing ?? {}),
            controller_props: {
              ...base.controller_props,
              ...(existing?.controller_props ?? {}),
              value: newValue,
              max: existing?.controller_props?.max ?? REMOTE_CTX_LEN_MAX,
            },
          }
        : base,
    },
  }
}

export function findProviderModelIndex(
  models: Model[],
  selected: Pick<Model, 'id' | 'model'>
): number {
  const byId = models.findIndex((m) => m.id === selected.id)
  if (byId !== -1) return byId
  if (selected.model) {
    const byModel = models.findIndex(
      (m) => m.id === selected.model || m.model === selected.model
    )
    if (byModel !== -1) return byModel
  }
  return models.findIndex((m) => m.model === selected.id)
}

export function contextOverflowMessage(
  promptTokens?: number,
  ctxTokens?: number
): string {
  if (
    promptTokens != null &&
    ctxTokens != null &&
    Number.isFinite(promptTokens) &&
    Number.isFinite(ctxTokens)
  ) {
    return `request (${promptTokens} tokens) exceeds the available context size (${ctxTokens} tokens)`
  }
  return OUT_OF_CONTEXT_SIZE
}
