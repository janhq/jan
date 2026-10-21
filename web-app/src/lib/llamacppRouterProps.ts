import { ExtensionManager } from '@/lib/extension'

export interface LlamacppModelProps {
  nCtx: number
  totalSlots?: number
  modelAlias?: string
  isSleeping?: boolean
}

interface LlamacppExtensionLike {
  getModelProps?: (modelId: string) => Promise<LlamacppModelProps | undefined>
  unload?: (modelId: string) => Promise<{ success: boolean; error?: string }>
}

const resolveExtensionWithProps = (
  names: string[]
): LlamacppExtensionLike | undefined => {
  const mgr = ExtensionManager.getInstance()
  for (const name of names) {
    const c = mgr.getByName(name)
    if (c && typeof (c as LlamacppExtensionLike).getModelProps === 'function')
      return c as LlamacppExtensionLike
  }
  return undefined
}

/** Post-fit `nCtx` is only available once the router has actually loaded the
 *  model; callers must fall back to a configured/default context size until then. */
export const getLlamacppExtension = (): LlamacppExtensionLike | undefined =>
  resolveExtensionWithProps([
    '@janhq/llamacpp-extension',
    'llamacpp-extension',
  ])

export const getMlxExtension = (): LlamacppExtensionLike | undefined =>
  resolveExtensionWithProps(['@janhq/mlx-extension', 'mlx-extension'])

/** The Python sidecar engines report their configured `ctx_size` the same way
 *  llama.cpp reports a launched `n_ctx`, which is what the token meter reads. */
export const getLocalEngineExtension = (
  provider: string
): LlamacppExtensionLike | undefined =>
  resolveExtensionWithProps([
    `@janhq/${provider}-extension`,
    `${provider}-extension`,
  ])

/** Local providers expose a launched context window via `getModelProps`; remote
 *  providers have none. */
export const getLocalPropsExtension = (
  provider?: string
): LlamacppExtensionLike | undefined => {
  if (!provider) return undefined
  if (provider === 'llamacpp') return getLlamacppExtension()
  if (provider === 'mlx') return getMlxExtension()
  if (provider === 'litert-lm' || provider === 'openvino')
    return getLocalEngineExtension(provider)
  return undefined
}

/** A ctx_len setting or launched n_ctx as a positive token count. The settings
 *  store keeps ctx_len as a number or a string, and '' when left to auto-fit. */
export const readCtxLen = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}
