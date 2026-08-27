import type { ModelsService } from '@/services/models/types'

const LOCAL_CODE_PROVIDERS: Record<string, true> = { llamacpp: true, mlx: true }

/** Start the selected local engine before the Rust agent resolves its upstream. */
export async function ensureCodeModelStarted(
  modelsService: Pick<ModelsService, 'startModel'>,
  provider: ProviderObject | undefined,
  modelId: string
): Promise<void> {
  if (!provider) {
    throw new Error(`No configured provider found for model '${modelId}'`)
  }
  if (!LOCAL_CODE_PROVIDERS[provider.provider]) return
  await modelsService.startModel(provider, modelId)
}
