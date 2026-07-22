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

/** Local providers expose a launched context window via `getModelProps`; remote
 *  providers have none. Returns undefined for anything but llamacpp/mlx. */
export const getLocalPropsExtension = (
  provider?: string
): LlamacppExtensionLike | undefined => {
  if (provider === 'llamacpp') return getLlamacppExtension()
  if (provider === 'mlx') return getMlxExtension()
  return undefined
}
