import { ExtensionManager } from '@/lib/extension'

export interface LlamacppModelProps {
  nCtx: number
  totalSlots?: number
  modelAlias?: string
  isSleeping?: boolean
}

interface LlamacppExtensionLike {
  getModelProps?: (modelId: string) => Promise<LlamacppModelProps | undefined>
}

/** Post-fit `nCtx` is only available once the router has actually loaded the
 *  model; callers must fall back to a configured/default context size until then. */
export const getLlamacppExtension = (): LlamacppExtensionLike | undefined => {
  const mgr = ExtensionManager.getInstance()
  const candidates = [
    mgr.getByName('@janhq/llamacpp-extension'),
    mgr.getByName('llamacpp-extension'),
  ]
  for (const c of candidates) {
    if (c && typeof (c as LlamacppExtensionLike).getModelProps === 'function')
      return c as LlamacppExtensionLike
  }
  return mgr.listExtensions().find(
    (ext) => typeof (ext as LlamacppExtensionLike).getModelProps === 'function'
  ) as LlamacppExtensionLike | undefined
}
