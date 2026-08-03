import type { CatalogModel } from '@/services/models/types'

/**
 * The single model the first-run screen offers, in a shape the download path can
 * consume without knowing where it came from. Anything beyond this model is
 * reached through the Hub rather than duplicated onto the setup screen.
 */
export interface SetupModelOption {
  /** Catalog model name; the Hub route key. */
  modelName: string
  displayName: string
  /** Id of the quant that will be downloaded. */
  modelId: string
  path: string
  fileSize: string
  multimodal: boolean
  mmprojPath?: string
}

/** F16 first, which is the projector quality the Hub publishes for every model. */
export function pickMmproj(model: CatalogModel): string | undefined {
  const projectors = model.mmproj_models ?? []
  if (projectors.length === 0) return undefined
  return (
    projectors.find((p) => p.model_id.toLowerCase() === 'mmproj-f16') ??
    projectors[0]
  ).path
}
