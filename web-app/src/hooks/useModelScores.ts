import { create } from 'zustand'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { localStorageKey } from '@/constants/localStorage'
import { fileStorage } from '@/lib/fileStorage'
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

function getEngine(provider: 'llamacpp' | 'mlx' = 'llamacpp') {
  return EngineManager.instance().get(provider) as AIEngine | undefined
}

function normalizeHubScoreResult(
  result: ModelScore,
  scoreSource: HubScoreRequestSource
): ModelScore {
  return {
    ...result,
    estimated_tps: result.estimated_tps ?? 0,
    scored_quant_model_id: result.scored_quant_model_id ?? scoreSource.model_id,
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
              scoreSource
            )

            hubScoreCache.set(requestKey, score)

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
