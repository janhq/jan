/**
 * Default Models Service - Web implementation
 */

import { sanitizeModelId } from '@/lib/utils'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import type { HardwareData } from '@/services/hardware/types'
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
  ModelQuant,
  ModelScore,
  SafetensorsFile,
} from './types'

// TODO: Replace this with the actual provider later
const defaultProvider = 'llamacpp'
const SCORE_CACHE_SCHEMA_VERSION = 'v2'
const SCORE_CACHE_FILE = 'llmfit_hub_scores.json'
const SCORE_CACHE_DIR = 'llamacpp'
const DEFAULT_SCORE_CTX_SIZE = 8192

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

interface ScoreCacheStore {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

interface CachedHubScoreEntry {
  result: ModelScore
}

type HubScoreRequestSource = {
  model_id: string
  path: string
  file_size: string
  runtime: 'llamacpp' | 'mlx'
  quantization?: string
  total_size_bytes?: number
}

export class DefaultModelsService implements ModelsService {
  private hubScoreCache = new Map<string, ModelScore>()
  private hubScoreRequests = new Map<string, Promise<ModelScore>>()
  private scoreStorePromise: Promise<ScoreCacheStore | null> | null = null
  private hardwareFingerprintPromise: Promise<string | null> | null = null

  private getEngine(provider: string = defaultProvider) {
    return EngineManager.instance().get(provider) as AIEngine | undefined
  }

  private async getScoreStore(): Promise<ScoreCacheStore | null> {
    if (this.scoreStorePromise) {
      return this.scoreStorePromise
    }

    this.scoreStorePromise = (async () => {
      if (!isTauriRuntime()) {
        return null
      }

      try {
        const [{ invoke }, { load }] = await Promise.all([
          import('@tauri-apps/api/core'),
          import('@tauri-apps/plugin-store'),
        ])
        const dataFolder = await invoke<string>('get_jan_data_folder_path')

        return (await load(
          `${dataFolder}/${SCORE_CACHE_DIR}/${SCORE_CACHE_FILE}`,
          {
            autoSave: false,
            defaults: {},
          }
        )) as ScoreCacheStore
      } catch (error) {
        console.warn(
          'Failed to initialize llmfit hub score cache store:',
          error
        )
        return null
      }
    })()

    return this.scoreStorePromise
  }

  private async readPersistedHubScore(
    cacheKey: string
  ): Promise<ModelScore | undefined> {
    const store = await this.getScoreStore()
    if (store) {
      const cached = await store.get<CachedHubScoreEntry>(cacheKey)
      return cached?.result
    }

    try {
      const rawCache = localStorage.getItem(SCORE_CACHE_FILE)
      if (!rawCache) {
        return undefined
      }

      const cache = JSON.parse(rawCache) as Record<string, CachedHubScoreEntry>
      return cache[cacheKey]?.result
    } catch (error) {
      console.warn(
        'Failed to read llmfit hub score cache from localStorage:',
        error
      )
      localStorage.removeItem(SCORE_CACHE_FILE)
      return undefined
    }
  }

  private async writePersistedHubScore(
    cacheKey: string,
    result: ModelScore
  ): Promise<void> {
    const entry: CachedHubScoreEntry = { result }
    const store = await this.getScoreStore()

    if (store) {
      try {
        await store.set(cacheKey, entry)
        await store.save()
        return
      } catch (error) {
        console.warn('Failed to write llmfit hub score cache store:', error)
      }
    }

    try {
      const rawCache = localStorage.getItem(SCORE_CACHE_FILE)
      const cache = rawCache
        ? (JSON.parse(rawCache) as Record<string, CachedHubScoreEntry>)
        : {}
      cache[cacheKey] = entry
      localStorage.setItem(SCORE_CACHE_FILE, JSON.stringify(cache))
    } catch (error) {
      console.warn(
        'Failed to write llmfit hub score cache to localStorage:',
        error
      )
    }
  }

  private encodeUint32LE(value: number): Uint8Array {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, value, true)
    return new Uint8Array(buffer)
  }

  private encodeUint64LE(value: number): Uint8Array {
    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setBigUint64(0, BigInt(value), true)
    return new Uint8Array(buffer)
  }

  private concatBytes(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0

    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  }

  private async sha256Hex(input: string | Uint8Array): Promise<string> {
    const bytes = Uint8Array.from(
      typeof input === 'string' ? new TextEncoder().encode(input) : input
    )
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  private async buildHardwareFingerprint(
    systemInfo: HardwareData
  ): Promise<string> {
    const encoder = new TextEncoder()
    const chunks: Uint8Array[] = [
      encoder.encode(systemInfo.os_type ?? ''),
      encoder.encode(systemInfo.os_name ?? ''),
      encoder.encode(systemInfo.cpu?.name ?? ''),
      encoder.encode(systemInfo.cpu?.arch ?? ''),
      this.encodeUint32LE(systemInfo.cpu?.core_count ?? 0),
      this.encodeUint64LE(systemInfo.total_memory ?? 0),
    ]

    for (const extension of systemInfo.cpu?.extensions ?? []) {
      chunks.push(encoder.encode(extension))
    }

    for (const gpu of systemInfo.gpus ?? []) {
      chunks.push(encoder.encode(gpu.name ?? ''))
      chunks.push(encoder.encode(gpu.uuid ?? ''))
      chunks.push(this.encodeUint64LE(gpu.total_memory ?? 0))
      chunks.push(encoder.encode(gpu.driver_version ?? ''))
    }

    return this.sha256Hex(this.concatBytes(chunks))
  }

  private async getHardwareFingerprint(): Promise<string | null> {
    if (this.hardwareFingerprintPromise) {
      return this.hardwareFingerprintPromise
    }

    this.hardwareFingerprintPromise = (async () => {
      if (!isTauriRuntime()) {
        return null
      }

      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const systemInfo = await invoke<HardwareData>(
          'plugin:hardware|get_system_info'
        )
        return await this.buildHardwareFingerprint(systemInfo)
      } catch (error) {
        console.warn('Failed to compute llmfit hardware fingerprint:', error)
        return null
      }
    })()

    return this.hardwareFingerprintPromise
  }

  private async getPersistentHubScoreCacheKey(
    scoreSource: HubScoreRequestSource
  ): Promise<string | null> {
    const hardwareFingerprint = await this.getHardwareFingerprint()
    if (!hardwareFingerprint) {
      return null
    }

    return this.sha256Hex(
      [
        SCORE_CACHE_SCHEMA_VERSION,
        scoreSource.model_id,
        scoreSource.path,
        DEFAULT_SCORE_CTX_SIZE,
        hardwareFingerprint,
      ].join('|')
    )
  }

  private normalizeHubScoreResult(
    result: ModelScore,
    scoreSource: HubScoreRequestSource,
    cacheKey: string | null
  ): ModelScore {
    return {
      ...result,
      estimated_tps: result.estimated_tps ?? 0,
      scored_quant_model_id:
        result.scored_quant_model_id ?? scoreSource.model_id,
      cache_key: result.cache_key ?? cacheKey ?? undefined,
      updated_at: result.updated_at ?? Math.floor(Date.now() / 1000),
    }
  }

  private getDefaultScoreVariant(model: CatalogModel): ModelQuant | undefined {
    return (
      model.quants?.find((variant) =>
        DEFAULT_MODEL_QUANTIZATIONS.some((quant) =>
          variant.model_id.toLowerCase().includes(quant)
        )
      ) ?? model.quants?.[0]
    )
  }

  private inferMlxQuantization(
    model: CatalogModel,
    safetensorsFiles: SafetensorsFile[]
  ): string {
    const combined = [
      model.model_name,
      model.developer,
      ...safetensorsFiles.map((file) => file.model_id),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    if (combined.includes('8bit') || combined.includes('mlx-8bit')) {
      return 'mlx-8bit'
    }

    return 'mlx-4bit'
  }

  private getDefaultMlxScoreSource(
    model: CatalogModel
  ): HubScoreRequestSource | undefined {
    const safetensorsFiles = model.safetensors_files ?? []
    const primaryFile = safetensorsFiles[0]
    if (!primaryFile) {
      return undefined
    }

    const totalSizeBytes = safetensorsFiles.reduce(
      (sum, file) => sum + (file.size_bytes ?? 0),
      0
    )

    return {
      model_id: primaryFile.model_id,
      path: primaryFile.path,
      file_size: primaryFile.file_size,
      runtime: 'mlx',
      quantization: this.inferMlxQuantization(model, safetensorsFiles),
      total_size_bytes: totalSizeBytes > 0 ? totalSizeBytes : undefined,
    }
  }

  private getHubScoreRequestSource(
    model: CatalogModel,
    variant?: ModelQuant
  ): HubScoreRequestSource | undefined {
    if (model.is_mlx) {
      return this.getDefaultMlxScoreSource(model)
    }

    const scoreVariant = variant ?? this.getDefaultScoreVariant(model)
    return scoreVariant
      ? {
          ...scoreVariant,
          runtime: 'llamacpp',
        }
      : undefined
  }

  private getHubScoreCacheKey(
    model: CatalogModel,
    variant?: ModelQuant
  ): string {
    const scoreSource = this.getHubScoreRequestSource(model, variant)
    return [
      model.model_name,
      scoreSource?.model_id ?? 'no-variant',
      scoreSource?.path ?? 'no-path',
    ].join('::')
  }

  async getModel(modelId: string): Promise<modelInfo | undefined> {
    return this.getEngine()?.get(modelId)
  }

  async fetchModels(): Promise<modelInfo[]> {
    return this.getEngine()?.list() ?? []
  }

  async fetchModelCatalog(): Promise<ModelCatalog> {
    try {
      const response = await fetch(MODEL_CATALOG_URL)

      if (!response.ok) {
        throw new Error(
          `Failed to fetch model catalog: ${response.status} ${response.statusText}`
        )
      }

      const catalog: ModelCatalog = await response.json()
      return catalog
    } catch (error) {
      console.error('Error fetching model catalog:', error)
      throw new Error(
        `Failed to fetch model catalog: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async fetchLatestJanModel(): Promise<CatalogModel | null> {
    try {
      const response = await fetch(LATEST_JAN_MODEL_URL)

      if (!response.ok) {
        console.error(
          `Failed to fetch latest Jan model: ${response.status} ${response.statusText}`
        )
        return null
      }

      const data = await response.json()

      const model: CatalogModel = Array.isArray(data) ? data[0] : data
      return model ?? null
    } catch (error) {
      console.error('Error fetching latest Jan model:', error)
      return null
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

      if (!cleanRepoId || !cleanRepoId.includes('/')) {
        return null
      }

      const response = await fetch(
        `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`,
        {
          headers: hfToken
            ? {
                Authorization: `Bearer ${hfToken}`,
              }
            : {},
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null // Repository not found
        }
        throw new Error(
          `Failed to fetch HuggingFace repository: ${response.status} ${response.statusText}`
        )
      }

      const repoData = await response.json()
      return repoData
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
        size_bytes: file.size,
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
    mmprojSize?: number
  ): Promise<void> {
    return this.getEngine()?.import(id, {
      modelPath,
      mmprojPath,
      modelSha256,
      modelSize,
      mmprojSha256,
      mmprojSize,
    })
  }

  async pullModelWithMetadata(
    id: string,
    modelPath: string,
    mmprojPath?: string,
    hfToken?: string,
    skipVerification: boolean = true
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

    // Call the original pullModel with the fetched metadata
    try {
      return await this.pullModel(
        id,
        modelPath,
        modelSha256,
        modelSize,
        mmprojPath,
        mmprojSha256,
        mmprojSize
      )
    } catch (error) {
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
    const llamacppEngine = this.getEngine('llamacpp')
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
    return this.getEngine(provider)?.getLoadedModels() ?? []
  }

  async stopModel(
    model: string,
    provider?: string
  ): Promise<UnloadResult | undefined> {
    return this.getEngine(provider)?.unload(model)
  }

  async stopAllModels(): Promise<void> {
    const llamaCppModels = await this.getActiveModels('llamacpp')
    if (llamaCppModels)
      await Promise.all(
        llamaCppModels.map((model) => this.stopModel(model, 'llamacpp'))
      )
    const mlxModels = await this.getActiveModels('mlx')
    if (mlxModels)
      await Promise.all(mlxModels.map((model) => this.stopModel(model, 'mlx')))
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
      const engine = this.getEngine('llamacpp') as AIEngine & {
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
      const engine = this.getEngine('llamacpp') as AIEngine & {
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

  async isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        isModelSupported?: (
          path: string,
          ctx_size?: number
        ) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      }
      if (engine && typeof engine.isModelSupported === 'function') {
        return await engine.isModelSupported(modelPath, ctxSize)
      }
      // Fallback if method is not available
      console.warn('isModelSupported method not available in llamacpp engine')
      return 'YELLOW' // Conservative fallback
    } catch (error) {
      console.error(`Error checking model support for ${modelPath}:`, error)
      return 'GREY' // Error state, assume not supported
    }
  }

  getCachedHubModelScore(
    model: CatalogModel,
    variant?: ModelQuant
  ): ModelScore | undefined {
    return this.hubScoreCache.get(this.getHubScoreCacheKey(model, variant))
  }

  async prefetchHubModelScore(
    model: CatalogModel,
    variant?: ModelQuant
  ): Promise<ModelScore> {
    return this.getHubModelScore(model, variant)
  }

  async getHubModelScore(
    model: CatalogModel,
    variant?: ModelQuant
  ): Promise<ModelScore> {
    const scoreSource = this.getHubScoreRequestSource(model, variant)
    const inMemoryCacheKey = this.getHubScoreCacheKey(model, variant)

    if (!scoreSource) {
      const unavailable: ModelScore = {
        status: 'unavailable',
        estimated_tps: 0,
        reason: model.is_mlx
          ? 'No MLX safetensors variant available for scoring.'
          : 'No GGUF variant available for scoring.',
      }
      this.hubScoreCache.set(inMemoryCacheKey, unavailable)
      return unavailable
    }

    const cached = this.hubScoreCache.get(inMemoryCacheKey)
    if (cached && cached.status !== 'loading') {
      return cached
    }

    const inFlight = this.hubScoreRequests.get(inMemoryCacheKey)
    if (inFlight) {
      return inFlight
    }

    const loadingState: ModelScore = {
      status: 'loading',
      estimated_tps: 0,
      scored_quant_model_id: scoreSource.model_id,
    }
    this.hubScoreCache.set(inMemoryCacheKey, loadingState)

    const request = (async () => {
      try {
        const persistentCacheKey =
          await this.getPersistentHubScoreCacheKey(scoreSource)
        if (persistentCacheKey) {
          const persisted = await this.readPersistedHubScore(persistentCacheKey)
          if (persisted) {
            const normalizedPersisted = this.normalizeHubScoreResult(
              persisted,
              scoreSource,
              persistentCacheKey
            )
            this.hubScoreCache.set(inMemoryCacheKey, normalizedPersisted)
            return normalizedPersisted
          }
        }

        const engine = this.getEngine('llamacpp') as AIEngine & {
          getHubModelScore?: (request: {
            model_name: string
            developer?: string
            default_quant_model_id: string
            model_path: string
            runtime?: 'llamacpp' | 'mlx'
            quantization?: string
            total_size_bytes?: number
            ctx_size?: number
            use_case?: string
            capabilities?: string[]
            release_date?: string
            tools?: boolean
            num_mmproj?: number
            pinned?: boolean
          }) => Promise<ModelScore>
        }

        if (!engine || typeof engine.getHubModelScore !== 'function') {
          const unavailable: ModelScore = {
            status: 'unavailable',
            estimated_tps: 0,
            reason: 'Hub scoring is not available on this platform.',
          }
          this.hubScoreCache.set(inMemoryCacheKey, unavailable)
          return unavailable
        }

        const result = this.normalizeHubScoreResult(
          await engine.getHubModelScore({
            model_name: model.model_name,
            developer: model.developer,
            default_quant_model_id: scoreSource.model_id,
            model_path: scoreSource.path,
            runtime: scoreSource.runtime,
            quantization: scoreSource.quantization,
            total_size_bytes: scoreSource.total_size_bytes,
            ctx_size: DEFAULT_SCORE_CTX_SIZE,
            use_case: model.use_case,
            capabilities: model.capabilities,
            release_date: model.created_at ?? model.createdAt,
            tools: model.tools,
            num_mmproj: model.num_mmproj,
            pinned: model.pinned,
          }),
          scoreSource,
          persistentCacheKey
        )

        this.hubScoreCache.set(inMemoryCacheKey, result)
        if (persistentCacheKey) {
          await this.writePersistedHubScore(persistentCacheKey, result)
        }

        return result
      } catch (error) {
        const failed: ModelScore = {
          status: 'error',
          estimated_tps: 0,
          reason:
            error instanceof Error ? error.message : 'Failed to score model.',
        }
        this.hubScoreCache.set(inMemoryCacheKey, failed)
        return failed
      } finally {
        this.hubScoreRequests.delete(inMemoryCacheKey)
      }
    })()

    this.hubScoreRequests.set(inMemoryCacheKey, request)
    return request
  }

  async validateGgufFile(filePath: string): Promise<ModelValidationResult> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
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
      const engine = this.getEngine('llamacpp') as AIEngine & {
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

      if (engine && typeof engine.getTokensCount === 'function') {
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

        return await engine.getTokensCount({
          model: modelId,
          messages: transformedMessages,
          chat_template_kwargs: {
            enable_thinking: false,
          },
        })
      }

      // Fallback if method is not available
      console.warn('getTokensCount method not available in llamacpp engine')
      return 0
    } catch (error) {
      console.error(`Error getting tokens count for model ${modelId}:`, error)
      return 0
    }
  }
}
