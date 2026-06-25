/**
 * Default Models Service - Web implementation
 */

import { sanitizeModelId, LOCAL_LLAMACPP_PROVIDER } from '@/lib/utils'
import {
  AIEngine,
  EngineManager,
  SessionInfo,
  SettingComponentProps,
  modelInfo,
  ThreadMessage,
  ContentType,
  events,
  DownloadEvent,
  UnloadResult,
} from '@janhq/core'
import { Model as CoreModel } from '@janhq/core'
import type {
  ModelsService,
  ModelCatalog,
  HuggingFaceRepo,
  CatalogModel,
  ModelValidationResult,
} from './types'
import { getCatalogOrFallback } from '@/services/model-catalog-registry'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import posthog from 'posthog-js'
import {
  isHfUrl,
  markDownloadStart,
  quantFromModelId,
  sizeBucket,
  urlHost,
} from '@/lib/telemetry'

// Platform-active llama.cpp provider id. Windows registers only the
// upstream extension ('llamacpp-upstream') after the 2026-05-22 ADR;
// macOS / Linux register the turboquant fork ('llamacpp'). Resolving
// this through LOCAL_LLAMACPP_PROVIDER keeps `getEngine()` calls
// platform-agnostic — without it, Windows `pullModel` / `validateGgufFile`
// silently no-op because the EngineManager has no 'llamacpp' entry.
const defaultProvider = LOCAL_LLAMACPP_PROVIDER
const HUGGING_FACE_SEARCH_LIMIT = 10
const localProviders = ['llamacpp', 'llamacpp-upstream', 'mlx'] as const
type LocalProviderName = (typeof localProviders)[number]

type HuggingFaceRepoSearchResult = Pick<
  HuggingFaceRepo,
  'downloads' | 'likes' | 'tags'
> & {
  id?: string
  modelId?: string
}

const normalizeHuggingFaceSearchValue = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const hasGgufFiles = (
  repo: Pick<HuggingFaceRepo, 'siblings'> | null | undefined
) =>
  repo?.siblings?.some((file) =>
    file.rfilename.toLowerCase().endsWith('.gguf')
  ) ?? false

const isLikelyGgufRepo = (repo: HuggingFaceRepoSearchResult) => {
  const repoId = getHuggingFaceRepoId(repo).toLowerCase()
  return (
    repoId.includes('gguf') ||
    repo.tags?.some((tag) => tag.toLowerCase().includes('gguf')) === true
  )
}

const getHuggingFaceRepoId = (
  repo: Pick<HuggingFaceRepoSearchResult, 'id' | 'modelId'>
) => repo.modelId ?? repo.id ?? ''

const scoreHuggingFaceRepoMatch = (
  query: string,
  repo: HuggingFaceRepoSearchResult
) => {
  const repoId = getHuggingFaceRepoId(repo)
  const repoTail = repoId.split('/').pop() ?? repoId
  const normalizedQuery = normalizeHuggingFaceSearchValue(query)
  const normalizedRepoId = normalizeHuggingFaceSearchValue(repoId)
  const normalizedRepoTail = normalizeHuggingFaceSearchValue(repoTail)

  let score = 0

  if (!normalizedQuery || !normalizedRepoId) {
    return score
  }

  if (normalizedRepoId === normalizedQuery) score += 300
  if (normalizedRepoTail === normalizedQuery) score += 240
  if (normalizedRepoTail.startsWith(normalizedQuery)) score += 120
  if (normalizedRepoId.includes(normalizedQuery)) score += 80

  if (repo.tags?.some((tag) => tag.toLowerCase() === 'gguf')) score += 30
  if (normalizedRepoId.includes('gguf')) score += 20

  score += Math.min(repo.downloads ?? 0, 100_000) / 1000
  score += Math.min(repo.likes ?? 0, 10_000) / 1000

  return score
}

export class DefaultModelsService implements ModelsService {
  private getEngine(provider: string = defaultProvider) {
    return EngineManager.instance().get(provider) as AIEngine | undefined
  }

  private async getLocalActiveModelsByProvider(): Promise<
    { provider: LocalProviderName; models: string[] }[]
  > {
    const results = await Promise.all(
      localProviders.map(async (provider) => ({
        provider,
        models: (await this.getEngine(provider)?.getLoadedModels()) ?? [],
      }))
    )

    return results.filter(({ models }) => Array.isArray(models) && models.length > 0)
  }

  private getHuggingFaceHeaders(hfToken?: string): HeadersInit | undefined {
    return hfToken
      ? {
          Authorization: `Bearer ${hfToken}`,
        }
      : undefined
  }

  private async fetchExactHuggingFaceRepo(
    cleanRepoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null> {
    const response = await fetch(
      `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`,
      {
        headers: this.getHuggingFaceHeaders(hfToken),
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }

      throw new Error(
        `Failed to fetch HuggingFace repository: ${response.status} ${response.statusText}`
      )
    }

    return response.json()
  }

  private async searchHuggingFaceRepo(
    query: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null> {
    const ggufQuery = /\bgguf\b/i.test(query) ? query : `${query} GGUF`
    const response = await fetch(
      `https://huggingface.co/api/models?search=${encodeURIComponent(ggufQuery)}&limit=${HUGGING_FACE_SEARCH_LIMIT}`,
      {
        headers: this.getHuggingFaceHeaders(hfToken),
      }
    )

    if (!response.ok) {
      throw new Error(
        `Failed to search HuggingFace repositories: ${response.status} ${response.statusText}`
      )
    }

    const results = ((await response.json()) as HuggingFaceRepoSearchResult[])
      .filter((repo) => getHuggingFaceRepoId(repo))
      .filter(isLikelyGgufRepo)
      .sort(
        (a, b) =>
          scoreHuggingFaceRepoMatch(query, b) -
          scoreHuggingFaceRepoMatch(query, a)
      )

    for (const repo of results) {
      const repoId = getHuggingFaceRepoId(repo)
      const repoDetails = await this.fetchExactHuggingFaceRepo(repoId, hfToken)

      if (hasGgufFiles(repoDetails)) {
        return repoDetails
      }
    }

    return null
  }

  async getModel(modelId: string): Promise<modelInfo | undefined> {
    return this.getEngine()?.get(modelId)
  }

  async fetchModels(): Promise<modelInfo[]> {
    return this.getEngine()?.list() ?? []
  }

  async fetchModelCatalog(): Promise<ModelCatalog> {
    // Primary source: the Atomic Chat curated catalog (`atomic-chat-model-catalog`
    // GitHub Releases) loaded via the registry abstraction so the same
    // localStorage cache + baseline fallback machinery is shared with
    // `useModelCatalogStore`. The loader never throws — on hard failure it
    // returns the bundled baseline so callers always get *something*.
    try {
      const result = await getCatalogOrFallback()
      return result.manifest.models
    } catch (error) {
      // Defensive only. `getCatalogOrFallback` already catches network /
      // schema errors and returns a baseline result.
      console.error('Unexpected fetchModelCatalog failure:', error)
      throw new Error(
        `Failed to fetch model catalog: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async searchHuggingFaceCandidates(
    query: string,
    hfToken?: string,
    limit = HUGGING_FACE_SEARCH_LIMIT
  ): Promise<CatalogModel[]> {
    const trimmed = query.trim()
    if (trimmed.length < 3) return []
    try {
      const ggufQuery = /\bgguf\b/i.test(trimmed) ? trimmed : `${trimmed} GGUF`
      const response = await fetch(
        `https://huggingface.co/api/models?search=${encodeURIComponent(ggufQuery)}&limit=${limit}`,
        { headers: this.getHuggingFaceHeaders(hfToken) }
      )
      if (!response.ok) return []
      const raw = (await response.json()) as HuggingFaceRepoSearchResult[]
      const ranked = raw
        .filter((repo) => getHuggingFaceRepoId(repo))
        .filter(isLikelyGgufRepo)
        .sort(
          (a, b) =>
            scoreHuggingFaceRepoMatch(trimmed, b) -
            scoreHuggingFaceRepoMatch(trimmed, a)
        )
      return ranked.slice(0, limit).map((repo) => {
        const repoId = getHuggingFaceRepoId(repo)
        const developer = repoId.includes('/')
          ? repoId.split('/', 1)[0]
          : undefined
        return {
          model_name: repoId,
          developer,
          downloads: repo.downloads ?? 0,
          description: `**Tags**: ${(repo.tags ?? []).join(', ')}`,
          // No quants / mmproj here — the detail fetch happens later when
          // the user clicks through to the dedicated model page.
          num_quants: 0,
          quants: [],
          num_mmproj: 0,
          mmproj_models: [],
          num_safetensors: 0,
          safetensors_files: [],
          is_mlx: (repo.tags ?? []).some((t) => t.toLowerCase() === 'mlx'),
          readme: `https://huggingface.co/${repoId}/resolve/main/README.md`,
        } satisfies CatalogModel
      })
    } catch (error) {
      console.warn('searchHuggingFaceCandidates failed:', error)
      return []
    }
  }

  async fetchHuggingFaceRepo(
    repoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null> {
    try {
      // Clean the repo ID to handle various input formats
      const cleanRepoId = repoId
        .replace(/^https?:\/\/huggingface\.co\//, '')
        .replace(/^huggingface\.co\//, '')
        .replace(/\/$/, '') // Remove trailing slash
        .trim()

      if (!cleanRepoId) {
        return null
      }

      if (cleanRepoId.includes('/')) {
        return await this.fetchExactHuggingFaceRepo(cleanRepoId, hfToken)
      }

      return await this.searchHuggingFaceRepo(cleanRepoId, hfToken)
    } catch (error) {
      console.error('Error fetching HuggingFace repository:', error)
      return null
    }
  }

  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel {
    // Format file size helper
    const formatFileSize = (size?: number) => {
      if (!size) return 'Unknown size'
      if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
      return `${(size / 1024 ** 3).toFixed(1)} GB`
    }

    // Extract GGUF files from the repository siblings
    const ggufFiles =
      repo.siblings?.filter((file) =>
        file.rfilename.toLowerCase().endsWith('.gguf')
      ) || []

    // Separate regular GGUF files from mmproj files
    const regularGgufFiles = ggufFiles.filter(
      (file) => !file.rfilename.toLowerCase().includes('mmproj')
    )

    const mmprojFiles = ggufFiles.filter((file) =>
      file.rfilename.toLowerCase().includes('mmproj')
    )

    // Convert regular GGUF files to quants format
    const quants = regularGgufFiles.map((file) => {
      // Generate model_id from filename (remove .gguf extension, case-insensitive)
      const modelId = file.rfilename.replace(/\.gguf$/i, '')

      return {
        model_id: `${repo.author}/${sanitizeModelId(modelId)}`,
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
      }
    })

    // Convert mmproj files to mmproj_models format
    const mmprojModels = mmprojFiles.map((file) => {
      const modelId = file.rfilename.replace(/\.gguf$/i, '')

      return {
        model_id: sanitizeModelId(modelId),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
      }
    })

    // Extract safetensors files (MLX models)
    const safetensorsFiles =
      repo.siblings?.filter((file) =>
        file.rfilename.toLowerCase().endsWith('.safetensors')
      ) || []

    // Check if this repository has MLX model files (safetensors + associated files)
    const hasMlxFiles =
      repo.library_name === 'mlx' || repo.tags?.includes('mlx')

    const safetensorsModels = safetensorsFiles.map((file) => {
      // Generate model_id from filename (remove .safetensors extension, case-insensitive)
      const modelId = file.rfilename.replace(/\.safetensors$/i, '')

      return {
        model_id: sanitizeModelId(modelId),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
        sha256: file.lfs?.sha256,
      }
    })

    return {
      model_name: repo.modelId,
      developer: repo.author,
      downloads: repo.downloads || 0,
      created_at: repo.createdAt,
      num_quants: quants.length,
      quants: quants,
      num_mmproj: mmprojModels.length,
      mmproj_models: mmprojModels,
      safetensors_files: safetensorsModels,
      num_safetensors: safetensorsModels.length,
      is_mlx: hasMlxFiles,
      readme: `https://huggingface.co/${repo.modelId}/resolve/main/README.md`,
      description: `**Tags**: ${repo.tags?.join(', ')}`,
    }
  }

  async updateModel(modelId: string, model: Partial<CoreModel>): Promise<void> {
    if (model.settings) {
      this.getEngine()?.updateSettings(
        model.settings as SettingComponentProps[]
      )
    }
    // Note: Model name/ID updates are handled at the provider level in the frontend
    // The engine doesn't have an update method for model metadata
    console.log('Model update request processed for modelId:', modelId)
  }

  async pullModel(
    id: string,
    modelPath: string,
    modelSha256?: string,
    modelSize?: number,
    mmprojPath?: string,
    mmprojSha256?: string,
    mmprojSize?: number,
    resume: boolean = false
  ): Promise<void> {
    return this.getEngine()?.import(id, {
      modelPath,
      mmprojPath,
      modelSha256,
      modelSize,
      mmprojSha256,
      mmprojSize,
      resume,
    })
  }

  async pullModelWithMetadata(
    id: string,
    modelPath: string,
    mmprojPath?: string,
    hfToken?: string,
    skipVerification: boolean = true,
    resume: boolean = false
  ): Promise<void> {
    let modelSha256: string | undefined
    let modelSize: number | undefined
    let mmprojSha256: string | undefined
    let mmprojSize: number | undefined

    // Extract repo ID from model URL
    // URL format: https://huggingface.co/{repo}/resolve/main/{filename}
    const modelUrlMatch = modelPath.match(
      /https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/main\/(.+)/
    )

    if (modelUrlMatch && !skipVerification) {
      const [, repoId, modelFilename] = modelUrlMatch

      try {
        // Fetch real-time metadata from HuggingFace
        const repoInfo = await this.fetchHuggingFaceRepo(repoId, hfToken)

        if (repoInfo?.siblings) {
          // Find the specific model file
          const modelFile = repoInfo.siblings.find(
            (file) => file.rfilename === modelFilename
          )
          if (modelFile?.lfs) {
            modelSha256 = modelFile.lfs.sha256
            modelSize = modelFile.lfs.size
          }

          // If mmproj path provided, extract its metadata too
          if (mmprojPath) {
            const mmprojUrlMatch = mmprojPath.match(
              /https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\/(.+)/
            )
            if (mmprojUrlMatch) {
              const [, mmprojFilename] = mmprojUrlMatch
              const mmprojFile = repoInfo.siblings.find(
                (file) => file.rfilename === mmprojFilename
              )
              if (mmprojFile?.lfs) {
                mmprojSha256 = mmprojFile.lfs.sha256
                mmprojSize = mmprojFile.lfs.size
              }
            }
          }
        }
      } catch (error) {
        console.warn(
          'Failed to fetch HuggingFace metadata, proceeding without hash verification:',
          error
        )
        // Continue with download even if metadata fetch fails
      }
    }

    // ATO-154: record resume parameters at the single GGUF download-start
    // choke point so the global Download popover can resume a paused download
    // (it only knows the model id, not these HF paths/token). MLX downloads go
    // through `engine.import` directly and are pause/resume-gated out.
    useDownloadStore.getState().setResumeParams(id, {
      modelPath,
      mmprojPath,
      hfToken,
      skipVerification,
    })

    // ATO-109: model_download funnel entry. Terminal events are emitted from
    // DownloadManagement listeners; this records the start (+ duration anchor).
    try {
      markDownloadStart(id)
      posthog.capture('model_download', {
        status: 'started',
        download_kind: 'model',
        model_id: id,
        quant: quantFromModelId(id),
        size_bucket: sizeBucket(modelSize),
        is_hf_url: isHfUrl(modelPath),
        resolved_asset_url_host: urlHost(modelPath),
        hf_token_present: !!hfToken,
      })
    } catch (telemetryError) {
      console.debug('model_download started telemetry failed:', telemetryError)
    }

    // Call the original pullModel with the fetched metadata
    try {
      return await this.pullModel(
        id,
        modelPath,
        modelSha256,
        modelSize,
        mmprojPath,
        mmprojSha256,
        mmprojSize,
        resume
      )
    } catch (error) {
      // ATO-154: a paused download stops the underlying transfer (which rejects
      // this promise with a cancellation error). Swallow it so the initiator's
      // catch doesn't fire a spurious "download failed" toast or clean up the
      // row — the download-stopped listener keeps the paused entry alive and
      // the popover shows a Resume button instead.
      if (useDownloadStore.getState().pausedDownloads.has(id)) {
        return
      }
      // Emit download error event so the UI can clean up the stale downloading state
      events.emit(DownloadEvent.onFileDownloadError, {
        modelId: id,
        downloadType: 'Model',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async abortDownload(id: string): Promise<void> {
    const llamacppEngine = this.getEngine(LOCAL_LLAMACPP_PROVIDER)
    const mlxEngine = this.getEngine('mlx')
    try {
      await Promise.allSettled(
        [llamacppEngine?.abortImport(id), mlxEngine?.abortImport(id)].filter(
          Boolean
        )
      )
    } finally {
      events.emit(DownloadEvent.onFileDownloadStopped, {
        modelId: id,
        downloadType: 'Model',
      })
    }
  }

  async deleteModel(id: string, provider?: string): Promise<void> {
    return this.getEngine(provider)?.delete(id)
  }

  async getActiveModels(provider?: string): Promise<string[]> {
    if (provider) {
      const scoped = (await this.getEngine(provider)?.getLoadedModels()) ?? []
      return scoped
    }

    const activeByProvider = await this.getLocalActiveModelsByProvider()
    const union = [...new Set(activeByProvider.flatMap(({ models }) => models))]
    return union
  }

  async stopModel(
    model: string,
    provider?: string
  ): Promise<UnloadResult | undefined> {
    if (provider) {
      const { ModelFactory } = await import('@/lib/model-factory')
      ModelFactory.invalidateLocalSessionCache(provider, model)
      return this.getEngine(provider)?.unload(model)
    }

    const activeByProvider = await this.getLocalActiveModelsByProvider()
    const matchingProviders = activeByProvider.filter(({ models }) =>
      models.includes(model)
    )

    if (matchingProviders.length === 0) {
      return undefined
    }

    const { ModelFactory } = await import('@/lib/model-factory')
    for (const { provider: providerName } of matchingProviders) {
      ModelFactory.invalidateLocalSessionCache(providerName, model)
    }

    const results = await Promise.allSettled(
      matchingProviders.map(({ provider: providerName }) =>
        this.getEngine(providerName)?.unload(model)
      )
    )
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    if (failures.length > 0) {
      return {
        success: false,
        error: failures
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          )
          .join('\n'),
      }
    }

    return results.find(
      (result): result is PromiseFulfilledResult<UnloadResult | undefined> =>
        result.status === 'fulfilled' && result.value !== undefined
    )?.value
  }

  async stopAllModels(): Promise<void> {
    const activeByProvider = await this.getLocalActiveModelsByProvider()
    await Promise.all(
      activeByProvider.flatMap(({ provider, models }) =>
        models.map((model) => this.stopModel(model, provider))
      )
    )
  }

  async startModel(
    provider: ProviderObject,
    model: string,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo | undefined> {
    const engine = this.getEngine(provider.provider)
    if (!engine) return undefined

    const loadedModels = await engine.getLoadedModels()
    if (loadedModels.includes(model)) return undefined

    // Find the model configuration to get settings
    const modelConfig = provider.models.find((m) => m.id === model)

    // Key mapping function to transform setting keys
    const mapSettingKey = (key: string): string => {
      const keyMappings: Record<string, string> = {
        ctx_len: 'ctx_size',
        ngl: 'n_gpu_layers',
      }
      return keyMappings[key] || key
    }

    const settings = modelConfig?.settings
      ? Object.fromEntries(
          Object.entries(modelConfig.settings).map(([key, value]) => [
            mapSettingKey(key),
            value.controller_props?.value,
          ])
        )
      : undefined

    return engine
      .load(model, settings, false, bypassAutoUnload)
      .catch((error) => {
        console.error(
          `Failed to start model ${model} for provider ${provider.provider}:`,
          error
        )
        throw error
      })
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    const engine = this.getEngine()
    if (!engine) return false

    return engine.isToolSupported(modelId)
  }

  async checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (
      providerName: string,
      data: Partial<ModelProvider>
    ) => void,
    getProviderByName?: (providerName: string) => ModelProvider | undefined
  ): Promise<{ exists: boolean; settingsUpdated: boolean }> {
    let settingsUpdated = false

    try {
      const engine = this.getEngine(LOCAL_LLAMACPP_PROVIDER) as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        const exists = await engine.checkMmprojExists(modelId)

        // If we have the store functions, use them; otherwise fall back to localStorage
        if (updateProvider && getProviderByName) {
          const provider = getProviderByName('llamacpp')
          if (provider) {
            const model = provider.models.find((m) => m.id === modelId)

            if (model?.settings) {
              const hasOffloadMmproj = 'offload_mmproj' in model.settings

              // If mmproj exists, add offload_mmproj setting (only if it doesn't exist)
              if (exists && !hasOffloadMmproj) {
                // Create updated models array with the new setting
                const updatedModels = provider.models.map((m) => {
                  if (m.id === modelId) {
                    return {
                      ...m,
                      settings: {
                        ...m.settings,
                        offload_mmproj: {
                          key: 'offload_mmproj',
                          title: 'Offload MMProj',
                          description:
                            'Offload multimodal projection model to GPU',
                          controller_type: 'checkbox',
                          controller_props: {
                            value: true,
                          },
                        },
                      },
                    }
                  }
                  return m
                })

                // Update the provider with the new models array
                updateProvider('llamacpp', { models: updatedModels })
                settingsUpdated = true
              }
            }
          }
        } else {
          // Fall back to localStorage approach for backwards compatibility
          try {
            const modelProviderData = JSON.parse(
              localStorage.getItem('model-provider') || '{}'
            )
            const llamacppProvider = modelProviderData.state?.providers?.find(
              (p: { provider: string }) => p.provider === 'llamacpp'
            )
            const model = llamacppProvider?.models?.find(
              (m: { id: string; settings?: Record<string, unknown> }) =>
                m.id === modelId
            )

            if (model?.settings) {
              // If mmproj exists, add offload_mmproj setting (only if it doesn't exist)
              if (exists) {
                if (!model.settings.offload_mmproj) {
                  model.settings.offload_mmproj = {
                    key: 'offload_mmproj',
                    title: 'Offload MMProj',
                    description: 'Offload multimodal projection layers to GPU',
                    controller_type: 'checkbox',
                    controller_props: {
                      value: true,
                    },
                  }
                  // Save updated settings back to localStorage
                  localStorage.setItem(
                    'model-provider',
                    JSON.stringify(modelProviderData)
                  )
                  settingsUpdated = true
                }
              }
            }
          } catch (localStorageError) {
            console.error(
              `Error checking localStorage for model ${modelId}:`,
              localStorageError
            )
          }
        }

        return { exists, settingsUpdated }
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return { exists: false, settingsUpdated }
  }

  async checkMmprojExists(modelId: string): Promise<boolean> {
    try {
      const engine = this.getEngine(LOCAL_LLAMACPP_PROVIDER) as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        return await engine.checkMmprojExists(modelId)
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return false
  }

  private static modelSupportCache = new Map<
    string,
    { status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY'; at: number }
  >()
  private static readonly MODEL_SUPPORT_CACHE_TTL_MS = 5 * 60 * 1000

  static invalidateModelSupportCache(): void {
    DefaultModelsService.modelSupportCache.clear()
  }

  async isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'> {
    const cacheKey = `${modelPath}::${ctxSize ?? 'default'}`
    const cached = DefaultModelsService.modelSupportCache.get(cacheKey)
    const now = Date.now()
    if (
      cached &&
      now - cached.at < DefaultModelsService.MODEL_SUPPORT_CACHE_TTL_MS
    ) {
      return cached.status
    }

    try {
      const engine = this.getEngine(LOCAL_LLAMACPP_PROVIDER) as AIEngine & {
        isModelSupported?: (
          path: string,
          ctx_size?: number
        ) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      }
      if (engine && typeof engine.isModelSupported === 'function') {
        const status = await engine.isModelSupported(modelPath, ctxSize)
        DefaultModelsService.modelSupportCache.set(cacheKey, {
          status,
          at: now,
        })
        return status
      }
      // Fallback if method is not available
      console.warn('isModelSupported method not available in llamacpp engine')
      return 'YELLOW' // Conservative fallback
    } catch (error) {
      console.error(`Error checking model support for ${modelPath}:`, error)
      return 'GREY' // Error state, assume not supported
    }
  }

  async validateGgufFile(filePath: string): Promise<ModelValidationResult> {
    try {
      const engine = this.getEngine(LOCAL_LLAMACPP_PROVIDER) as AIEngine & {
        validateGgufFile?: (path: string) => Promise<ModelValidationResult>
      }

      if (engine && typeof engine.validateGgufFile === 'function') {
        return await engine.validateGgufFile(filePath)
      }

      // If the specific method isn't available, we can fallback to a basic check
      console.warn('validateGgufFile method not available in llamacpp engine')
      return {
        isValid: true, // Assume valid for now
        error: 'Validation method not available',
      }
    } catch (error) {
      console.error(`Error validating GGUF file ${filePath}:`, error)
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getTokensCount(
    modelId: string,
    messages: ThreadMessage[]
  ): Promise<number> {
    try {
      const engine = this.getEngine(LOCAL_LLAMACPP_PROVIDER)
      const typedEngine = engine as AIEngine & {
        getTokensCount?: (opts: {
          model: string
          messages: Array<{
            role: string
            content:
              | string
              | Array<{
                  type: string
                  text?: string
                  image_url?: {
                    detail?: string
                    url?: string
                  }
                }>
          }>
          chat_template_kwargs?: {
            enable_thinking: boolean
          }
        }) => Promise<number>
      }
      console.debug(
        '[TokenCounter:service] engine found:',
        !!engine,
        'hasMethod:',
        typeof typedEngine?.getTokensCount
      )

      if (typedEngine && typeof typedEngine.getTokensCount === 'function') {
        // Transform Jan's ThreadMessage format to OpenAI chat completion format
        const transformedMessages = messages
          .map((message) => {
            // Handle different content types
            let content:
              | string
              | Array<{
                  type: string
                  text?: string
                  image_url?: {
                    detail?: string
                    url?: string
                  }
                }> = ''

            if (message.content && message.content.length > 0) {
              // Check if there are any image_url content types
              const hasImages = message.content.some(
                (content) => content.type === ContentType.Image
              )

              if (hasImages) {
                // For multimodal messages, preserve the array structure
                content = message.content.map((contentItem) => {
                  if (contentItem.type === ContentType.Text) {
                    return {
                      type: 'text',
                      text: contentItem.text?.value || '',
                    }
                  } else if (contentItem.type === ContentType.Image) {
                    return {
                      type: 'image_url',
                      image_url: {
                        detail: contentItem.image_url?.detail,
                        url: contentItem.image_url?.url || '',
                      },
                    }
                  }
                  // Fallback for unknown content types
                  return {
                    type: contentItem.type,
                    text: contentItem.text?.value,
                    image_url: contentItem.image_url,
                  }
                })
              } else {
                // For text-only messages, keep the string format
                const textContents = message.content
                  .filter(
                    (content) =>
                      content.type === ContentType.Text && content.text?.value
                  )
                  .map((content) => content.text?.value || '')

                content = textContents.join(' ')
              }
            }

            return {
              role: message.role,
              content,
            }
          })
          .filter((msg) =>
            typeof msg.content === 'string'
              ? msg.content.trim() !== ''
              : Array.isArray(msg.content) && msg.content.length > 0
          ) // Filter out empty messages

        if (transformedMessages.length === 0) {
          return 0
        }

        console.debug(
          '[TokenCounter:service] calling engine.getTokensCount with',
          { modelId, msgCount: transformedMessages.length }
        )
        const timeoutMs = 30000
        const result = await Promise.race([
          typedEngine.getTokensCount({
            model: modelId,
            messages: transformedMessages,
            chat_template_kwargs: {
              enable_thinking: false,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('getTokensCount timed out')),
              timeoutMs
            )
          ),
        ])
        console.debug('[TokenCounter:service] engine returned', result)
        return result
      }

      console.warn(
        '[TokenCounter:service] getTokensCount method not available in llamacpp engine'
      )
      return 0
    } catch (error) {
      console.error('[TokenCounter:service] error getting tokens count:', error)
      return 0
    }
  }
}
