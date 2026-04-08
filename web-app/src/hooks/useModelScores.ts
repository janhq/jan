import { create } from 'zustand'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'
import type { HardwareData } from '@/services/hardware/types'
import { createJSONStorage, persist } from 'zustand/middleware'
import { AIEngine, EngineManager } from '@janhq/core'
import type {
  CatalogModel,
  ModelQuant,
  ModelScore,
  SafetensorsFile,
} from '@/services/models/types'

type ModelScoreState = {
  scores: Record<string, ModelScore>
  error: Error | null
  loading: boolean
  getScore: (modelId: string) => ModelScore | undefined
  getCachedHubModelScore: (
    model: CatalogModel,
    variant?: ModelQuant
  ) => ModelScore | undefined
  fetchModelScore: (
    model: CatalogModel,
    variant?: ModelQuant
  ) => Promise<ModelScore>
  fetchPreferredModelScore: (model: CatalogModel) => Promise<ModelScore>
  reset: () => void
}

const DEFAULT_SCORE_CTX_SIZE = 8192
const SCORE_CACHE_SCHEMA_VERSION = 'v2'
const SCORE_CACHE_FILE = 'llmfit_hub_scores.json'
const SCORE_CACHE_DIR = 'llamacpp'

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

const hubScoreCache = new Map<string, ModelScore>()
const scoreRequests = new Map<string, Promise<ModelScore>>()

let scoreStorePromise: Promise<ScoreCacheStore | null> | null = null
let hardwareFingerprintPromise: Promise<string | null> | null = null

function getEngine(provider: 'llamacpp' | 'mlx' = 'llamacpp') {
  return EngineManager.instance().get(provider) as AIEngine | undefined
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function getScoreStore(): Promise<ScoreCacheStore | null> {
  if (scoreStorePromise) {
    return scoreStorePromise
  }

  scoreStorePromise = (async () => {
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
      console.warn('Failed to initialize llmfit hub score cache store:', error)
      return null
    }
  })()

  return scoreStorePromise
}

async function readPersistedHubScore(
  cacheKey: string
): Promise<ModelScore | undefined> {
  const store = await getScoreStore()
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

async function writePersistedHubScore(
  cacheKey: string,
  result: ModelScore
): Promise<void> {
  const entry: CachedHubScoreEntry = { result }
  const store = await getScoreStore()

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

function encodeUint32LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4)
  new DataView(buffer).setUint32(0, value, true)
  return new Uint8Array(buffer)
}

function encodeUint64LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setBigUint64(0, BigInt(value), true)
  return new Uint8Array(buffer)
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(
    typeof input === 'string' ? new TextEncoder().encode(input) : input
  )
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function buildHardwareFingerprint(
  systemInfo: HardwareData
): Promise<string> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = [
    encoder.encode(systemInfo.os_type ?? ''),
    encoder.encode(systemInfo.os_name ?? ''),
    encoder.encode(systemInfo.cpu?.name ?? ''),
    encoder.encode(systemInfo.cpu?.arch ?? ''),
    encodeUint32LE(systemInfo.cpu?.core_count ?? 0),
    encodeUint64LE(systemInfo.total_memory ?? 0),
  ]

  for (const extension of systemInfo.cpu?.extensions ?? []) {
    chunks.push(encoder.encode(extension))
  }

  for (const gpu of systemInfo.gpus ?? []) {
    chunks.push(encoder.encode(gpu.name ?? ''))
    chunks.push(encoder.encode(gpu.uuid ?? ''))
    chunks.push(encodeUint64LE(gpu.total_memory ?? 0))
    chunks.push(encoder.encode(gpu.driver_version ?? ''))
  }

  return sha256Hex(concatBytes(chunks))
}

async function getHardwareFingerprint(): Promise<string | null> {
  if (hardwareFingerprintPromise) {
    return hardwareFingerprintPromise
  }

  hardwareFingerprintPromise = (async () => {
    if (!isTauriRuntime()) {
      return null
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const systemInfo = await invoke<HardwareData>(
        'plugin:hardware|get_system_info'
      )
      return await buildHardwareFingerprint(systemInfo)
    } catch (error) {
      console.warn('Failed to compute llmfit hardware fingerprint:', error)
      return null
    }
  })()

  return hardwareFingerprintPromise
}

async function getPersistentHubScoreCacheKey(
  scoreSource: HubScoreRequestSource
): Promise<string | null> {
  const hardwareFingerprint = await getHardwareFingerprint()
  if (!hardwareFingerprint) {
    return null
  }

  return sha256Hex(
    [
      SCORE_CACHE_SCHEMA_VERSION,
      scoreSource.model_id,
      scoreSource.path,
      DEFAULT_SCORE_CTX_SIZE,
      hardwareFingerprint,
    ].join('|')
  )
}

function normalizeHubScoreResult(
  result: ModelScore,
  scoreSource: HubScoreRequestSource,
  cacheKey: string | null
): ModelScore {
  return {
    ...result,
    estimated_tps: result.estimated_tps ?? 0,
    scored_quant_model_id: result.scored_quant_model_id ?? scoreSource.model_id,
    cache_key: result.cache_key ?? cacheKey ?? undefined,
    updated_at: result.updated_at ?? Math.floor(Date.now() / 1000),
  }
}

function getDefaultScoreVariant(model: CatalogModel): ModelQuant | undefined {
  return (
    model.quants?.find((variant) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((quant) =>
        variant.model_id.toLowerCase().includes(quant)
      )
    ) ?? model.quants?.[0]
  )
}

function inferMlxQuantization(
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

function getDefaultMlxScoreSource(
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
    quantization: inferMlxQuantization(model, safetensorsFiles),
    total_size_bytes: totalSizeBytes > 0 ? totalSizeBytes : undefined,
  }
}

function getHubScoreRequestSource(
  model: CatalogModel,
  variant?: ModelQuant
): HubScoreRequestSource | undefined {
  if (model.is_mlx) {
    return getDefaultMlxScoreSource(model)
  }

  const scoreVariant = variant ?? getDefaultScoreVariant(model)
  return scoreVariant
    ? {
        ...scoreVariant,
        runtime: 'llamacpp',
      }
    : undefined
}

function getHubScoreCacheKey(
  model: CatalogModel,
  variant?: ModelQuant
): string {
  const scoreSource = getHubScoreRequestSource(model, variant)
  return [
    model.model_name,
    scoreSource?.model_id ?? 'no-variant',
    scoreSource?.path ?? 'no-path',
  ].join('::')
}

function getScoreableVariants(
  model: CatalogModel
): Array<ModelQuant | undefined> {
  if (model.is_mlx || !model.quants?.length) {
    return [undefined]
  }

  return model.quants
}

function pickPreferredModelScore(
  scores: Array<ModelScore | undefined>
): ModelScore | undefined {
  const readyScores = scores.filter(
    (score): score is ModelScore => score?.status === 'ready'
  )

  if (readyScores.length > 0) {
    return readyScores.reduce((bestScore, currentScore) => {
      const bestOverall = bestScore.overall ?? Number.NEGATIVE_INFINITY
      const currentOverall = currentScore.overall ?? Number.NEGATIVE_INFINITY
      return currentOverall > bestOverall ? currentScore : bestScore
    })
  }

  return (
    scores.find((score) => score?.status === 'loading') ?? scores.find(Boolean)
  )
}

export const useModelScore = create<ModelScoreState>()(
  persist(
    (set, get) => ({
      scores: {},
      error: null,
      loading: false,

      getScore: (modelId: string) => get().scores[modelId],

      getCachedHubModelScore: (model: CatalogModel, variant?: ModelQuant) =>
        hubScoreCache.get(getHubScoreCacheKey(model, variant)),

      fetchModelScore: async (model: CatalogModel, variant?: ModelQuant) => {
        const requestKey = getHubScoreCacheKey(model, variant)
        const inFlightRequest = scoreRequests.get(requestKey)

        if (inFlightRequest) {
          return inFlightRequest
        }

        const cachedScore = hubScoreCache.get(requestKey)
        if (cachedScore && !variant) {
          set((state) => ({
            scores: {
              ...state.scores,
              [model.model_name]: cachedScore,
            },
          }))
          if (cachedScore.status !== 'loading') {
            return cachedScore
          }
        }

        const scoreSource = getHubScoreRequestSource(model, variant)

        if (!scoreSource) {
          const unavailable: ModelScore = {
            status: 'unavailable',
            estimated_tps: 0,
            reason: model.is_mlx
              ? 'No MLX safetensors variant available for scoring.'
              : 'No GGUF variant available for scoring.',
          }
          hubScoreCache.set(requestKey, unavailable)
          if (!variant) {
            set((state) => ({
              scores: {
                ...state.scores,
                [model.model_name]: unavailable,
              },
            }))
          }
          return unavailable
        }

        if (!variant) {
          set((state) => ({
            loading: true,
            error: null,
            scores: {
              ...state.scores,
              [model.model_name]: {
                status: 'loading',
                estimated_tps: 0,
              },
            },
          }))
        }

        const loadingState: ModelScore = {
          status: 'loading',
          estimated_tps: 0,
          scored_quant_model_id: scoreSource.model_id,
        }
        hubScoreCache.set(requestKey, loadingState)

        const request = (async () => {
          try {
            const persistentCacheKey =
              await getPersistentHubScoreCacheKey(scoreSource)

            if (persistentCacheKey) {
              const persisted = await readPersistedHubScore(persistentCacheKey)
              if (persisted) {
                const normalizedPersisted = normalizeHubScoreResult(
                  persisted,
                  scoreSource,
                  persistentCacheKey
                )
                hubScoreCache.set(requestKey, normalizedPersisted)
                if (!variant) {
                  set((state) => ({
                    loading: false,
                    error: null,
                    scores: {
                      ...state.scores,
                      [model.model_name]: normalizedPersisted,
                    },
                  }))
                }

                return normalizedPersisted
              }
            }

            const engine = getEngine('llamacpp') as AIEngine & {
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
              hubScoreCache.set(requestKey, unavailable)
              if (!variant) {
                set((state) => ({
                  scores: {
                    ...state.scores,
                    [model.model_name]: unavailable,
                  },
                  loading: false,
                  error: null,
                }))
              }
              return unavailable
            }

            const score = normalizeHubScoreResult(
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

            hubScoreCache.set(requestKey, score)
            if (persistentCacheKey) {
              await writePersistedHubScore(persistentCacheKey, score)
            }

            if (!variant) {
              set((state) => ({
                loading: false,
                error: null,
                scores: {
                  ...state.scores,
                  [model.model_name]: score,
                },
              }))
            }

            return score
          } catch (error) {
            const failedScore: ModelScore = {
              status: 'error',
              estimated_tps: 0,
              reason:
                error instanceof Error
                  ? error.message
                  : 'Failed to score model.',
            }

            hubScoreCache.set(requestKey, failedScore)

            if (!variant) {
              set((state) => ({
                loading: false,
                error: error as Error,
                scores: {
                  ...state.scores,
                  [model.model_name]: failedScore,
                },
              }))
            }

            return failedScore
          } finally {
            scoreRequests.delete(requestKey)
          }
        })()

        scoreRequests.set(requestKey, request)
        return request
      },

      fetchPreferredModelScore: async (model: CatalogModel) => {
        const requestKey = `${model.model_name}::preferred`
        const inFlightRequest = scoreRequests.get(requestKey)

        if (inFlightRequest) {
          return inFlightRequest
        }

        const scoreableVariants = getScoreableVariants(model)
        const cachedScores = scoreableVariants.map((variant) =>
          get().getCachedHubModelScore(model, variant)
        )
        const preferredCachedScore = pickPreferredModelScore(cachedScores)

        set((state) => ({
          loading: true,
          error: null,
          scores: {
            ...state.scores,
            [model.model_name]: preferredCachedScore ?? {
              status: 'loading',
              estimated_tps: 0,
            },
          },
        }))

        const request = Promise.all(
          scoreableVariants.map((variant) =>
            get().fetchModelScore(model, variant)
          )
        )
          .then((scores) => {
            const preferredScore =
              pickPreferredModelScore(scores) ??
              ({
                status: 'unavailable',
                estimated_tps: 0,
                reason: 'No scoreable model variants available.',
              } satisfies ModelScore)

            set((state) => ({
              loading: false,
              error: null,
              scores: {
                ...state.scores,
                [model.model_name]: preferredScore,
              },
            }))

            return preferredScore
          })
          .catch((error) => {
            const failedScore: ModelScore = {
              status: 'error',
              estimated_tps: 0,
              reason:
                error instanceof Error
                  ? error.message
                  : 'Failed to score model.',
            }

            set((state) => ({
              loading: false,
              error: error as Error,
              scores: {
                ...state.scores,
                [model.model_name]: failedScore,
              },
            }))

            return failedScore
          })
          .finally(() => {
            scoreRequests.delete(requestKey)
          })

        scoreRequests.set(requestKey, request)
        return request
      },

      reset: () => {
        hubScoreCache.clear()
        scoreRequests.clear()
        scoreStorePromise = null
        hardwareFingerprintPromise = null
        set({
          scores: {},
          error: null,
          loading: false,
        })
      },
    }),
    {
      name: localStorageKey.modelScores,
      storage: createJSONStorage(() => fileStorage),
    }
  )
)
